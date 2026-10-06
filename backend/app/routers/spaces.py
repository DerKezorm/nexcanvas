"""Spaces: the list with their members and teams (for avatars and the sidebar), making, renaming, colouring, the
bin, and the rights of teams.

Members and invitations are in ``routers/members.py``.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import Account, DbSession
from ..errors import error
from ..models import MANAGE, OPERATOR, SPACE_ROLES, Board, Membership, Space, Team, TeamGrant, TeamMember
from ..models import Account as AccountRow
from ..services import rights, spaces, suite

logger = logging.getLogger("nexcanvas.spaces")

router = APIRouter(prefix="/api/spaces", tags=["spaces"])

SpaceId = Annotated[int, PathParam(ge=1)]


class SpaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=16)


class TeamRight(BaseModel):
    role: str = Field(pattern="^(read|write|manage)$")


class SpaceChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=16)


def _fail(exc: spaces.SpaceError | rights.RightsError) -> Exception:
    return error(exc.code, exc.text, exc.status)


def _view(db: DbSession, account: AccountRow, space: Space) -> dict[str, Any]:
    rows = db.execute(
        select(Membership, AccountRow)
        .join(AccountRow, AccountRow.id == Membership.account_id)
        .where(Membership.space_id == space.id)
        .order_by(AccountRow.name)
    ).all()
    count = db.scalar(
        select(func.count()).select_from(Board).where(Board.space_id == space.id, Board.deleted_at.is_(None))
    )
    teams = db.execute(
        select(TeamGrant, Team).join(Team, Team.id == TeamGrant.team_id).where(TeamGrant.space_id == space.id)
        .order_by(Team.name)
    ).all()
    team_ids = [grant.team_id for grant, _team in teams]
    in_teams = set(db.scalars(select(TeamMember.account_id).where(TeamMember.team_id.in_(team_ids))))
    return {
        "id": space.id,
        "name": space.name,
        "color": space.color,
        "role": rights.role_in(db, account, space.id),
        "boards": int(count or 0),
        # Everybody who gets in, through an own right or a team, each once (Prüfgang D3).
        "people": len({person.id for _m, person in rows} | in_teams),
        # Its rights come from nexsuite: changed there, not here.
        "managed": bool(space.external_id) and suite.connected(db),
        # nexsuite no longer gives this app the space: only the operator sees it, and may put it into the trash (B18).
        "dropped": suite.dropped(db, space),
        "teams": [{"id": team.id, "name": team.name, "color": team.color, "role": grant.role} for grant, team in teams],
        "members": [
            {
                "id": person.id,
                "name": person.name,
                "display_name": person.display_name,
                "role": membership.role,
                "avatar": person.avatar_at.isoformat() if person.avatar_at else None,
            }
            for membership, person in rows
        ],
    }


@router.get("", summary="The spaces the own account may read")
def listing(account: Account, db: DbSession) -> list[dict[str, Any]]:
    ids = rights.readable_ids(db, account)
    rows = db.scalars(select(Space).where(Space.id.in_(ids)).order_by(Space.created_at)) if ids else []
    return [_view(db, account, space) for space in rows]


@router.post("", status_code=201, summary="Make a space; the own account manages it")
def create(payload: SpaceIn, account: Account, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    try:
        space = spaces.create(db, account, payload.name, payload.color)
    except spaces.SpaceError as exc:
        raise _fail(exc) from exc
    return _view(db, account, space)


@router.patch("/{space_id}", summary="Rename or recolour a space (managers)")
def change(space_id: SpaceId, payload: SpaceChange, account: Account, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_space_managed(db, space_id, account)
    try:
        space = rights.check(db, account, space_id, MANAGE)
        spaces.change(db, space, payload.name, payload.color)
    except (spaces.SpaceError, rights.RightsError) as exc:
        raise _fail(exc) from exc
    return _view(db, account, space)


@router.delete("/{space_id}", status_code=204, summary="Move a space with its boards to the trash (managers)")
def trash(space_id: SpaceId, account: Account, db: DbSession) -> None:
    # A space nexsuite no longer gives this app: the operator puts it into the trash here (B18, decided 05.10.2026).
    if not (suite.dropped(db, db.get(Space, space_id)) and rights.operator_powers(account)):
        suite.refuse_if_space_managed(db, space_id, account)
    try:
        space = rights.check(db, account, space_id, MANAGE)
    except rights.RightsError as exc:
        raise _fail(exc) from exc
    spaces.trash(db, space)
    logger.info("Space in the trash id=%s by=%s", space.id, account.name)


@router.get("/bin", summary="Spaces in the trash the own account managed")
def bin_listing(account: Account, db: DbSession) -> list[dict[str, Any]]:
    query = select(Space).where(Space.deleted_at.is_not(None))
    if account.role != OPERATOR:
        query = query.join(Membership, Membership.space_id == Space.id).where(
            Membership.account_id == account.id, Membership.role == MANAGE)
    connected = suite.connected(db)
    # The operator sees every space in the bin (D4); one deleted in nexsuite says so and comes back there (E1).
    return [
        {"id": space.id, "name": space.name, "color": space.color, "deleted_at": space.deleted_at.isoformat(),
         "in_suite": bool(space.external_id) and connected and space.suite_dropped_at is None}
        for space in db.scalars(query.order_by(Space.deleted_at.desc()))
    ]


@router.post("/{space_id}/restore", summary="Bring a space back from the trash (its managers)")
def restore(space_id: SpaceId, account: Account, db: DbSession) -> dict[str, Any]:
    space = db.get(Space, space_id)
    membership = db.get(Membership, (space_id, account.id)) if space is not None else None
    allowed = account.role == OPERATOR or (membership is not None and membership.role == MANAGE)
    if space is None or space.deleted_at is None or not allowed:
        raise error("not_found", "Not found.", 404)
    # One the operator put into the trash after nexsuite let it go comes back the same way (B18).
    if not (suite.dropped(db, space) and rights.operator_powers(account)):
        suite.refuse_if_space_managed(db, space.id)
    space.deleted_at = None
    db.commit()
    return _view(db, account, space)


@router.put("/{space_id}/teams/{team_id}", summary="Give a team a right in the space (managers)")
def give_team(
    space_id: SpaceId, team_id: SpaceId, payload: TeamRight, account: Account, db: DbSession
) -> dict[str, Any]:
    suite.refuse_if_space_managed(db, space_id, account)
    try:
        space = rights.check(db, account, space_id, MANAGE)
    except rights.RightsError as exc:
        raise _fail(exc) from exc
    if db.get(Team, team_id) is None or payload.role not in SPACE_ROLES:
        raise error("not_found", "Not found.", 404)
    grant = db.get(TeamGrant, (space_id, team_id))
    if grant is None:
        db.add(TeamGrant(space_id=space_id, team_id=team_id, role=payload.role))
    else:
        grant.role = payload.role
    db.commit()
    logger.info("Team right set space=%s team=%s role=%s by=%s", space_id, team_id, payload.role, account.name)
    return _view(db, account, space)


@router.delete("/{space_id}/teams/{team_id}", summary="Take a team's right in the space away (managers)")
def take_team(space_id: SpaceId, team_id: SpaceId, account: Account, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_space_managed(db, space_id, account)
    try:
        space = rights.check(db, account, space_id, MANAGE)
    except rights.RightsError as exc:
        raise _fail(exc) from exc
    grant = db.get(TeamGrant, (space_id, team_id))
    if grant is not None:
        db.delete(grant)
        db.commit()
    # A manager who had the right only through this team may have lost the space now: then it is gone for them.
    if rights.role_in(db, account, space_id) is None:
        return {"id": space_id, "gone": True}
    return _view(db, account, space)

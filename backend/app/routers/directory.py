"""People and teams as the pages need them, the same in every app of the family (nextasks has it too): everybody on the
server sees everybody.

Teams are made and deleted by the operator; the members of a local team change by the operator, and by the team's lead
when the operator allows it (``team_leads_edit``, off from the start, D3).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import Account, DbSession, OperatorAccount
from ..errors import error
from ..models import OPERATOR, TEAM_LOCAL, Team
from ..models import Account as AccountRow
from ..services import settings_service, suite, teams

logger = logging.getLogger("nexcanvas.teams")

router = APIRouter(prefix="/api", tags=["directory"])

TeamId = Annotated[int, PathParam(ge=1)]


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#ff8a70", max_length=16)
    members: list[int] = Field(default_factory=list, max_length=1000)
    lead: int | None = None


class TeamChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=16)
    members: list[int] | None = Field(default=None, max_length=1000)
    lead: int | None = None


def _fail(exc: teams.TeamError) -> Exception:
    return error(exc.code, exc.text, exc.status)


def person_view(row: AccountRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "display_name": row.display_name or row.name,
        "avatar": row.avatar_at.isoformat() if row.avatar_at else None,
    }


@router.get("/directory", summary="Everybody on the server and every team")
def directory(account: Account, db: DbSession) -> dict[str, Any]:
    # As people read them: by the shown name, any case (b3-20).
    people = sorted(db.scalars(select(AccountRow)),
                    key=lambda row: ((row.display_name or row.name).casefold(), row.name))
    # Blocked accounts (here, or gone or blocked in nexsuite) are no colleagues to pick; the operator still sees
    # them, marked (D6).
    operator = account.role == "operator"
    return {
        "me": account.id,
        "people": [{**person_view(row), "blocked": row.blocked_at is not None} for row in people
                   if operator or row.blocked_at is None],
        "teams": [teams.view(db, team) for team in db.scalars(select(Team).order_by(Team.name))],
    }


@router.post("/teams", status_code=201, summary="Make a team (operator)")
def create_team(payload: TeamIn, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    try:
        team = teams.create(db, payload.name, payload.color)
        if payload.members:
            teams.set_members(db, team, payload.members)
        if payload.lead is not None:
            _set_lead(db, team, payload.lead)
    except teams.TeamError as exc:
        db.rollback()
        raise _fail(exc) from exc
    logger.info("Team made id=%s by=%s", team.id, operator.name)
    return teams.view(db, team)


def _set_lead(db: DbSession, team: Team, lead: int | None) -> None:
    if lead is not None and not teams.is_member(db, team.id, lead):
        raise teams.TeamError("lead_not_member", "The lead must be in the team.")
    team.lead_id = lead
    db.commit()


@router.patch("/teams/{team_id}", summary="Rename, recolour, change members or lead (operator; members also the lead, "
                                         "when the operator allows it)")
def change_team(team_id: TeamId, payload: TeamChange, account: Account, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    team = db.get(Team, team_id)
    if team is None:
        raise error("not_found", "Not found.", 404)
    if not teams.may_change(account, team, bool(settings_service.get(db, "team_leads_edit"))):
        if team.lead_id == account.id and team.source == TEAM_LOCAL:
            # The lead hears why: the operator has not let team leads change their teams (D3).
            raise error("team_leads_off", "The operator has not let team leads change their teams.", 403)
        raise error("forbidden", "Only the operator or the team's lead changes a team.", 403)
    lead_only = account.role != OPERATOR
    try:
        if lead_only and (payload.name is not None or payload.color is not None or "lead" in payload.model_fields_set):
            raise teams.TeamError("forbidden", "The lead changes the members only.", 403)
        if payload.name is not None:
            team.name = teams.clean_name(payload.name)
        if payload.color is not None:
            team.color = teams.clean_color(payload.color)
        db.commit()
        if payload.members is not None:
            teams.set_members(db, team, payload.members)
        if "lead" in payload.model_fields_set:
            _set_lead(db, team, payload.lead)
    except teams.TeamError as exc:
        db.rollback()
        raise _fail(exc) from exc
    return teams.view(db, team)


@router.delete("/teams/{team_id}", status_code=204, summary="Delete a team (operator); its rights in spaces go with it")
def delete_team(team_id: TeamId, operator: OperatorAccount, db: DbSession) -> None:
    suite.refuse_if_managed(db)
    team = db.get(Team, team_id)
    if team is None:
        raise error("not_found", "Not found.", 404)
    # Members and the team's rights in spaces go by the database's cascade.
    db.delete(team)
    db.commit()
    logger.info("Team deleted id=%s by=%s", team_id, operator.name)

"""Who is in which space, and the invitations that bring people in.

A manager of a space invites, gives and takes rights there. Naming an account brings it an invitation, never a
membership it did not agree to, and the answer is the same whether the name exists or not.

The operator may reset the rights of any space (a manager left, an account was deleted): it sees names of spaces and
of members, never what is inside, and cannot give itself a right in a space that has members. It can give one to
another account, though, or take the last member out and so make the space its own: that is never hidden, every
member and the account concerned get a notice (``services/notices``).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import Account, DbSession, OperatorAccount, client_ip
from ..errors import detail, error
from ..models import (
    MANAGE,
    OPERATOR,
    SPACE_ROLES,
    Invite,
    Membership,
    Space,
    SpaceNotice,
    Team,
    TeamGrant,
    TeamMember,
)
from ..models import Account as AccountRow
from ..security import MIN_PASSWORD, SESSION_COOKIE, brake, session_account
from ..services import accounts, mailer, notices, rights, settings_service, suite
from ..services.accounts import AccountError
from .auth import check_password, fail, sign_in

logger = logging.getLogger("nexcanvas.auth")

router = APIRouter(prefix="/api", tags=["members"])

SpaceId = Annotated[int, PathParam(ge=1)]
AccountName = Annotated[str, PathParam(min_length=1, max_length=64)]
Token = Annotated[str, PathParam(min_length=20, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


def _space(db: DbSession, account: AccountRow, space_id: int, *, operator_may: bool = False) -> Space:
    """The space, when the account manages it (or, with ``operator_may``, is the operator). Not readable: 404."""
    space = db.get(Space, space_id)
    if space is None or space.deleted_at is not None:
        raise error("not_found", "No such space.", 404)
    role = rights.role_in(db, account, space.id)
    if operator_may and rights.operator_powers(account):
        return space
    if not rights.at_least(role, rights.READ):
        raise error("not_found", "No such space.", 404)
    if not rights.at_least(role, MANAGE):
        raise error("forbidden", "Only a manager of this space may do this.", 403)
    return space


def _members(db: DbSession, space_id: int) -> list[Any]:
    return list(
        db.execute(
            select(Membership, AccountRow)
            .join(AccountRow, AccountRow.id == Membership.account_id)
            .where(Membership.space_id == space_id)
            .order_by(AccountRow.name)
        ).all()
    )


def _managers_left(db: DbSession, space_id: int, without: int) -> int:
    """Managers of the space besides ``without``: people, and teams with the right to manage that have somebody else
    in them."""
    people = db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.space_id == space_id, Membership.role == MANAGE, Membership.account_id != without)
    ) or 0
    teams = db.scalar(
        select(func.count(func.distinct(TeamGrant.team_id)))
        .join(TeamMember, TeamMember.team_id == TeamGrant.team_id)
        .where(TeamGrant.space_id == space_id, TeamGrant.role == MANAGE, TeamMember.account_id != without)
    ) or 0
    return int(people) + int(teams)


def _others(db: DbSession, space_id: int, without: int) -> int:
    """Whoever else has a right in the space: people, and teams."""
    people = db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.space_id == space_id, Membership.account_id != without)
    ) or 0
    teams = db.scalar(select(func.count()).select_from(TeamGrant).where(TeamGrant.space_id == space_id)) or 0
    return int(people) + int(teams)


def _invite_view(invite: Invite, db: DbSession) -> dict[str, Any]:
    by = db.get(AccountRow, invite.created_by) if invite.created_by else None
    return {
        "id": invite.id,
        "role": invite.space_role,
        "email": invite.email,
        "by": by.name if by else None,
        "created_at": invite.created_at.isoformat(),
        "expires_at": invite.expires_at.isoformat(),
    }


def _link(db: DbSession, request: Request, token: str) -> str:
    base = settings_service.public_url(db) or str(request.base_url).rstrip("/")
    return f"{base}/invite/{token}"


# --- Members of a space ---------------------------------------------------------------------------------------------


class MemberIn(BaseModel):
    role: str = Field(max_length=16)


@router.get("/spaces/{space_id}/members", summary="Who is in the space, and the open invitations")
def members(space_id: SpaceId, account: Account, db: DbSession) -> dict[str, Any]:
    # Everybody in the space sees who else is (all see all), with the teams that have a right; changing it and the
    # open invitations are the managers' (Prüfgang D3: readers and writers saw a form that only failed).
    space = db.get(Space, space_id)
    if space is None or space.deleted_at is not None:
        raise error("not_found", "No such space.", 404)
    role = rights.role_in(db, account, space.id)
    if not rights.at_least(role, rights.READ) and not rights.operator_powers(account):
        raise error("not_found", "No such space.", 404)
    managing = rights.at_least(role, MANAGE) or rights.operator_powers(account)
    rows = _members(db, space.id)
    invites = list(db.scalars(select(Invite).where(Invite.space_id == space.id).order_by(Invite.created_at)))
    grants = list(db.execute(select(TeamGrant, Team).join(Team, Team.id == TeamGrant.team_id)
                             .where(TeamGrant.space_id == space.id).order_by(Team.name)))
    in_teams = {
        grant.team_id: set(db.scalars(select(TeamMember.account_id).where(TeamMember.team_id == grant.team_id)))
        for grant, _team in grants
    }
    everybody = {person.id for _membership, person in rows}.union(*in_teams.values())
    return {
        "space": space.name,
        "space_id": space.id,
        "members": [
            {"name": person.name, "role": membership.role, "you": person.id == account.id}
            for membership, person in rows
        ],
        "teams": [{"id": team.id, "name": team.name, "color": team.color, "role": grant.role,
                   "people": len(in_teams[team.id])} for grant, team in grants],
        "count": len(everybody),
        "invites": [_invite_view(invite, db) for invite in invites if not accounts.expired(invite)] if managing else [],
        # Invitations by name not answered yet: seen and withdrawn by the managers (F2).
        "asked": [{"id": notice.id, "name": person.name, "role": notice.role, "at": notice.created_at.isoformat()}
                  for notice, person in db.execute(
                      select(SpaceNotice, AccountRow).join(AccountRow, AccountRow.id == SpaceNotice.account_id)
                      .where(SpaceNotice.space_id == space.id, SpaceNotice.kind == notices.INVITE,
                             SpaceNotice.done_at.is_(None)).order_by(AccountRow.name))] if managing else [],
        "role": rights.role_in(db, account, space.id),
        # Connected to nexsuite: the accounts come from there (no invitation links), and so do the rights of a space
        # nexsuite gives this app.
        "suite": suite.connected(db),
        "managed": bool(space.external_id) and suite.connected(db),
    }


@router.delete("/spaces/{space_id}/asked/{notice_id}", status_code=204, summary="Withdraw an invitation by name")
def withdraw_asked(space_id: SpaceId, notice_id: Annotated[int, PathParam(ge=1)], account: Account,
                   db: DbSession) -> None:
    space = _space(db, account, space_id, operator_may=True)
    notice = db.get(SpaceNotice, notice_id)
    if notice is None or notice.space_id != space.id or notice.kind != notices.INVITE or notice.done_at is not None:
        raise error("not_found", "No such invitation.", 404)
    db.delete(notice)
    db.commit()
    logger.info("Invitation by name withdrawn space_id=%s by=%s", space.id, account.name)


@router.put("/spaces/{space_id}/members/{person}", summary="Change a member's right, or invite an account by name")
def set_member(
    space_id: SpaceId, person: AccountName, payload: MemberIn, account: Account, db: DbSession, response: Response
) -> dict:
    suite.refuse_if_space_managed(db, space_id, account)
    if payload.role not in SPACE_ROLES:
        raise error("invalid_role", "Unknown right.", 422)
    space = _space(db, account, space_id, operator_may=True)
    own = rights.role_in(db, account, space.id)
    # The operator acting where it does not manage: allowed, but every member is told.
    beyond = rights.operator_powers(account) and not rights.at_least(rights.own_role_in(db, account, space.id), MANAGE)
    target = accounts.by_name(db, person)
    membership = db.get(Membership, (space.id, target.id)) if target is not None else None
    if membership is None and not beyond and (target is None or target.id != account.id):
        # A name brings an invitation, answered under "New"; unknown names get the same answer, the same work and
        # the same limit, and nothing happens.
        key = f"invite-by:{account.id}"
        if brake.wait_seconds(key, NAMES_PER_HOUR):
            raise error("too_many_attempts", "Too many invitations. Try again later.", 429)
        brake.failed(key)
        notices.invite(db, space, target, payload.role, account)
        db.commit()
        if target is not None:
            logger.info("Invited space_id=%s name=%s role=%s by=%s", space.id, target.name, payload.role, account.name)
        response.status_code = 202
        return {"name": person, "role": payload.role, "invited": True}
    if target is None:
        raise error("no_such_account", "There is no account of that name.", 404)
    if target.id == account.id and not rights.at_least(own, MANAGE):
        # The operator resets rights, it does not take them.
        raise error("forbidden", "You cannot give yourself a right in this space.", 403)
    if (
        membership is not None
        and membership.role == MANAGE
        and payload.role != MANAGE
        and _managers_left(db, space.id, target.id) == 0
        and _others(db, space.id, target.id) > 0
    ):
        raise error("last_manager", "The space needs another manager first.", 409)
    if membership is None:
        if _others(db, space.id, -1) == 0 and target.id != account.id and account.role == OPERATOR:
            # A space without members is the operator's; giving it to somebody keeps the operator in as manager,
            # unless the operator takes itself out afterwards.
            db.add(Membership(space_id=space.id, account_id=account.id, role=MANAGE))
        db.add(Membership(space_id=space.id, account_id=target.id, role=payload.role))
    else:
        membership.role = payload.role
    if beyond:
        kind = notices.OPERATOR_ADDED if membership is None else notices.OPERATOR_ROLE
        db.flush()
        notices.tell(db, space, kind, account, target.name, payload.role, also=(target.id,))
    db.commit()
    logger.info("Right set space_id=%s name=%s role=%s by=%s", space.id, target.name, payload.role, account.name)
    return {"name": target.name, "role": payload.role}


@router.delete("/spaces/{space_id}/members/{person}", status_code=204, summary="Take an account out of the space")
def remove_member(space_id: SpaceId, person: AccountName, account: Account, db: DbSession) -> None:
    suite.refuse_if_space_managed(db, space_id, account)
    target = accounts.by_name(db, person)
    leaving = target is not None and target.id == account.id
    if leaving:
        space = db.get(Space, space_id)
        if space is None or db.get(Membership, (space.id, account.id)) is None:
            raise error("not_found", "No such space.", 404)
    else:
        space = _space(db, account, space_id, operator_may=True)
    membership = db.get(Membership, (space.id, target.id)) if target is not None else None
    if target is None or membership is None:
        # Unknown and not a member answer alike: a manager learns nothing about names outside the space.
        raise error("not_a_member", "This account is not in the space.", 404)
    if membership.role == MANAGE and _managers_left(db, space.id, target.id) == 0 and _others(db, space.id, target.id):
        raise error("last_manager", "The space needs another manager first.", 409)
    beyond = (
        not leaving and rights.operator_powers(account)
        and not rights.at_least(rights.own_role_in(db, account, space.id), MANAGE)
    )
    db.delete(membership)
    if beyond:
        # Taking the last member out makes the space the operator's: the one taken out is told as well.
        db.flush()
        notices.tell(db, space, notices.OPERATOR_REMOVED, account, target.name, also=(target.id,))
    db.commit()
    logger.info("Right taken space_id=%s name=%s by=%s", space.id, target.name, account.name)


class NoticeOut(BaseModel):
    id: int
    kind: str
    space: str
    role: str
    actor: str
    subject: str
    created_at: datetime


@router.get("/notices", response_model=list[NoticeOut], summary="Open invitations and what the operator changed")
def open_notices(account: Account, db: DbSession) -> list[NoticeOut]:
    return [NoticeOut(**vars(item)) for item in notices.open_for(db, account.id)]


@router.post("/notices/{notice_id}/accept", summary="Accept an invitation into a space")
def accept_notice(notice_id: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> dict[str, str]:
    notice = db.get(SpaceNotice, notice_id)
    if notice is not None and notice.space_id is not None:
        suite.refuse_if_space_managed(db, notice.space_id)
    try:
        space = notices.answer(db, account, notice_id, accept=True)
    except notices.NoticeError as exc:
        raise error(exc.code, "No such invitation.", exc.status) from exc
    logger.info("Invitation accepted notice=%s name=%s", notice_id, account.name)
    return {"space": space or ""}


@router.post("/notices/{notice_id}/decline", status_code=204, summary="Decline an invitation, or mark a notice seen")
def decline_notice(notice_id: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> None:
    try:
        notices.answer(db, account, notice_id, accept=False)
    except notices.NoticeError as exc:
        raise error(exc.code, "No such notice.", exc.status) from exc


@router.get("/admin/spaces", summary="Every space with its members, for the operator (no contents)")
def all_spaces(operator: OperatorAccount, db: DbSession) -> list[dict[str, Any]]:
    result = []
    for space in db.scalars(select(Space).where(Space.deleted_at.is_(None)).order_by(Space.name)):
        rows = _members(db, space.id)
        result.append(
            {
                "id": space.id,
                "name": space.name,
                "members": len(rows),
                "managers": [person.name for membership, person in rows if membership.role == MANAGE],
                "role": rights.role_in(db, operator, space.id),
            }
        )
    return result


# --- Invitations ----------------------------------------------------------------------------------------------------


class InviteIn(BaseModel):
    role: str = Field(default="", max_length=16)
    days: int = 7
    email: str = Field(default="", max_length=255)
    send: bool = False


class AcceptIn(BaseModel):
    name: str = Field(max_length=64)
    password: str = Field(max_length=200)


#: Invitation mails one account may send in an hour; invitations by name one account may hand out in an hour.
MAILS_PER_HOUR = 20
NAMES_PER_HOUR = 60


def _create(db: DbSession, request: Request, by: AccountRow, space: Space | None, payload: InviteIn) -> dict:
    email = payload.email.strip()
    if email and not accounts.EMAIL_PATTERN.match(email):
        raise error("invalid_email", "This is not a mail address.", 422)
    if payload.send and not email:
        raise error("invalid_email", "Sending needs a mail address.", 422)
    if payload.send:
        # A mail goes out under the operator's mail server: never with a link to an address the request made up
        # (the Host header), and not without end.
        if not settings_service.public_url(db):
            raise error("public_url_missing", "Mail needs the public address of nexcanvas; the operator sets it.", 409)
        key = f"invite-mail:{by.id}"
        if brake.wait_seconds(key, MAILS_PER_HOUR):
            raise error("too_many_attempts", "Too many invitation mails. Try again later.", 429)
        brake.failed(key)
    if email:
        # One open invitation per address and place: a second one replaces the first (Prüfgang F2), so no old link
        # stays valid beside the new one.
        place = Invite.space_id == space.id if space else Invite.space_id.is_(None)
        for old in db.scalars(select(Invite).where(func.lower(Invite.email) == email.lower(), place)):
            db.delete(old)
    try:
        invite, token = accounts.create_invite(
            db, by, space_id=space.id if space else None, space_role=payload.role if space else "",
            days=payload.days, email=email,
        )
    except AccountError as exc:
        raise fail(exc) from exc
    link = _link(db, request, token)
    sent = False
    if payload.send:
        try:
            # Named as others see the inviter; the link says until when it works (g3-6, b3-20).
            mailer.send_invite(db, email, link, by=by.display_name or by.name, space=space.name if space else None,
                               until=invite.expires_at.date().isoformat())
            sent = True
        except mailer.MailError as exc:
            # The link was to go by mail only: kept, the invitation would stand without anybody holding its link.
            db.delete(invite)
            db.commit()
            raise error(exc.code, str(exc), 502) from exc
    return {**_invite_view(invite, db), "link": link, "sent": sent}


@router.post("/spaces/{space_id}/invites", status_code=201, summary="Invite into the space; the link is shown once")
def invite_to_space(space_id: SpaceId, payload: InviteIn, request: Request, account: Account, db: DbSession) -> dict:
    suite.refuse_if_managed(db)
    suite.refuse_if_space_managed(db, space_id, account)
    space = _space(db, account, space_id)
    if payload.role not in SPACE_ROLES:
        raise error("invalid_role", "Unknown right.", 422)
    return _create(db, request, account, space, payload)


@router.get("/invites", summary="Open invitations without a space (operator)")
def list_invites(_operator: OperatorAccount, db: DbSession) -> list[dict[str, Any]]:
    return [_invite_view(invite, db) for invite in accounts.invites_of(db, space_id=None)]


@router.post("/invites", status_code=201, summary="Invite into nexcanvas without a space (operator)")
def invite(payload: InviteIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    if payload.role:
        raise error("invalid_role", "A right needs a space.", 422)
    return _create(db, request, operator, None, payload)


@router.delete("/invites/{invite_id}", status_code=204, summary="Withdraw an invitation")
def withdraw(invite_id: int, account: Account, db: DbSession) -> None:
    row = db.get(Invite, invite_id)
    allowed = row is not None and (
        rights.operator_powers(account)
        or row.created_by == account.id
        or (row.space_id is not None and rights.at_least(rights.role_in(db, account, row.space_id), MANAGE))
    )
    if row is None or not allowed:
        raise error("not_found", "No such invitation.", 404)
    db.delete(row)
    db.commit()


def _valid(db: DbSession, token: str) -> Invite:
    row = accounts.find_invite(db, token)
    if row is None:
        raise error("invite_invalid", "This invitation is not valid any more.", 404)
    return row


@router.get("/invite/{token}", summary="What an invitation offers (no sign-in needed)")
def invite_state(token: Token, request: Request, db: DbSession) -> dict[str, Any]:
    row = _valid(db, token)
    space = db.get(Space, row.space_id) if row.space_id else None
    signed_in = session_account(db, request.cookies.get(SESSION_COOKIE))
    return {
        "space": space.name if space else None,
        "role": row.space_role or None,
        "min_password": MIN_PASSWORD,
        "signed_in_as": signed_in.name if signed_in else None,
    }


#: Taken names one sender may try when accepting invitations before it waits.
NAME_TRIES = 8


@router.post("/invite/{token}", summary="Accept an invitation with a new account")
def accept(token: Token, payload: AcceptIn, request: Request, response: Response, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    # A name that is taken must be said, so the person can pick another; the brake keeps it from being a way to try
    # names one after another (one link took 60 tries without a pause).
    key = "invite-name:" + client_ip(request)
    wait = brake.wait_seconds(key, NAME_TRIES)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=detail("too_many_attempts", "Too many attempts. Try again later.", retry_after=wait),
            headers={"Retry-After": str(wait)},
        )
    check_password(payload.password)
    if not settings_service.get(db, "password_login"):
        raise error("password_login_off", "Sign-in with a password is turned off.", 403)
    try:
        account = accounts.accept_invite(db, token, payload.name, payload.password)
    except AccountError as exc:
        if exc.code == "name_taken":
            brake.failed(key)
        raise fail(exc) from exc
    return sign_in(db, request, response, account)


@router.post("/invite/{token}/join", summary="Accept an invitation with the signed-in account")
def join(token: Token, account: Account, db: DbSession) -> dict[str, Any]:
    # Connected, rights come from nexsuite: an invitation from before is no way in (A9).
    suite.refuse_if_managed(db)
    row = _valid(db, token)
    if row.space_id is None:
        raise error("already_member", "You have an account already.", 409)
    own = db.get(AccountRow, account.id)
    assert own is not None
    space = db.get(Space, row.space_id)
    try:
        accounts.redeem(db, row, own)
    except AccountError as exc:
        raise fail(exc) from exc
    return {"space": space.name if space else None}

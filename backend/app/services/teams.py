"""Teams: who works together. The same in every app of the family (nextasks has them too).

A team is kept by nexcanvas itself (``local``) or later by the family's admin app (``admin``). nexcanvas changes the
members of a local team only; an ``admin`` team follows its source.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import OPERATOR, TEAM_LOCAL, Account, Team, TeamMember
from .names import CONTROL_TEXT, has_control

logger = logging.getLogger("nexcanvas.teams")

COLOR = re.compile(r"^#[0-9a-f]{6}$")
MAX_NAME = 80


class TeamError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


def clean_name(name: str) -> str:
    if has_control(name):
        raise TeamError("invalid_characters", CONTROL_TEXT)
    text = " ".join(name.split())
    if not text or len(text) > MAX_NAME:
        raise TeamError("invalid_name", "A team needs a name of 1 to 80 characters.")
    return text


def clean_color(color: str) -> str:
    value = color.strip().lower()
    if not COLOR.match(value):
        raise TeamError("invalid_color", "Not a colour.")
    return value


def members(db: Session, team_id: int) -> list[int]:
    return list(db.scalars(select(TeamMember.account_id).where(TeamMember.team_id == team_id).order_by(
        TeamMember.account_id)))


def teams_of(db: Session, account_id: int) -> set[int]:
    return set(db.scalars(select(TeamMember.team_id).where(TeamMember.account_id == account_id)))


def is_member(db: Session, team_id: int, account_id: int) -> bool:
    return db.get(TeamMember, (team_id, account_id)) is not None


def may_change(account: Account, team: Team, leads_edit: bool) -> bool:
    """The operator changes every team; the lead the members of a local team, when the operator allows leads to
    (``team_leads_edit``, off from the start as in nextasks and nexbrand, also for installations from before:
    decided 2026-10-06, D3)."""
    return account.role == OPERATOR or (leads_edit and team.lead_id == account.id and team.source == TEAM_LOCAL)


def view(db: Session, team: Team) -> dict:
    everybody = members(db, team.id)
    return {
        "id": team.id,
        "name": team.name,
        "color": team.color,
        "lead": team.lead_id,
        "source": team.source,
        "members": everybody,
        "size": len(everybody),
    }


def create(db: Session, name: str, color: str) -> Team:
    team = Team(name=clean_name(name), color=clean_color(color), source=TEAM_LOCAL)
    db.add(team)
    db.commit()
    logger.info("Team created id=%s", team.id)
    return team


def set_members(db: Session, team: Team, account_ids: Iterable[int]) -> None:
    """Only for a local team: the members follow the source otherwise."""
    if team.source != TEAM_LOCAL:
        raise TeamError("team_not_local", "The members of this team are kept elsewhere.", 409)
    wanted = set(account_ids)
    known = set(db.scalars(select(Account.id).where(Account.id.in_(wanted)))) if wanted else set()
    if known != wanted:
        raise TeamError("unknown_account", "Not every account exists.")
    current = set(members(db, team.id))
    for account_id in wanted - current:
        db.add(TeamMember(team_id=team.id, account_id=account_id))
    for account_id in current - wanted:
        db.delete(db.get(TeamMember, (team.id, account_id)))
    if team.lead_id is not None and team.lead_id not in wanted:
        team.lead_id = None
    db.commit()

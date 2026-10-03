"""Who may do what in which space, as in nexlore, with teams as in nextasks.

Three rights, each including the ones before it: **read** (open boards, follow them live), **write** (change boards,
add photos, the bin), **manage** (inviting, giving rights to people and teams, public pages, renaming or deleting the
space). A person has the right given to them (``memberships``) or to a team they are in (``team_grants``), the higher
of all.

**The operator sees and manages every space** in the interface: whoever runs the server sees
everything. A program acting with the operator's token does not: it has the operator's own rights, and the spaces
nobody has. When the operator changes the members of a space it has no right of its own in, they are told
(``own_role_in``, ``routers/members.py``).

**Nothing leaks.** A space or board somebody may not read is treated as if it did not exist: the same 404 as for one
that really does not exist, no name in any list, no title in the search.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    MANAGE,
    OPERATOR,
    READ,
    SPACE_ROLES,
    WRITE,
    Account,
    Board,
    Membership,
    Space,
    TeamGrant,
    TeamMember,
)

__all__ = [
    "MANAGE",
    "READ",
    "WRITE",
    "RightsError",
    "at_least",
    "board_for",
    "check",
    "own_role_in",
    "owned",
    "readable_ids",
    "role_in",
    "team_members_of",
]


class RightsError(Exception):
    """``not_found`` when the space may not even be seen, ``forbidden`` when it may be seen but not changed."""

    def __init__(self, code: str, text: str, status: int) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


def operator_powers(account: Account) -> bool:
    """The operator acting where it does not manage (members, public pages): in the interface, never through a
    program's token."""
    return account.role == OPERATOR and not account.via_key


def at_least(role: str | None, need: str) -> bool:
    return role is not None and SPACE_ROLES.index(role) >= SPACE_ROLES.index(need)


def higher(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if SPACE_ROLES.index(a) >= SPACE_ROLES.index(b) else b


def owned(db: Session, space_id: int) -> bool:
    """Whether anybody has a right in the space, as a person or through a team. A space nobody has is the
    operator's."""
    people = db.scalar(select(func.count()).select_from(Membership).where(Membership.space_id == space_id)) or 0
    teams = db.scalar(select(func.count()).select_from(TeamGrant).where(TeamGrant.space_id == space_id)) or 0
    return bool(people or teams)


def _team_role(db: Session, account_id: int, space_id: int) -> str | None:
    role: str | None = None
    rows = db.scalars(
        select(TeamGrant.role)
        .join(TeamMember, TeamMember.team_id == TeamGrant.team_id)
        .where(TeamGrant.space_id == space_id, TeamMember.account_id == account_id)
    )
    for value in rows:
        role = higher(role, value)
    return role


def team_members_of(db: Session, space_id: int) -> set[int]:
    """Everybody who has a right in the space through a team."""
    return set(db.scalars(
        select(TeamMember.account_id).join(TeamGrant, TeamGrant.team_id == TeamMember.team_id)
        .where(TeamGrant.space_id == space_id)
    ))


def role_in(db: Session, account: Account, space_id: int | None) -> str | None:
    """The account's right in the space, or None. A token limited to some spaces sees no other."""
    if space_id is None:
        return None
    if account.key_spaces is not None and space_id not in account.key_spaces:
        return None
    space = db.get(Space, space_id)
    if space is None or space.deleted_at is not None:
        return None
    if operator_powers(account):
        return MANAGE
    role = own_role_in(db, account, space_id)
    if role is not None:
        return role
    if account.role == OPERATOR and not owned(db, space_id):
        return MANAGE
    return None


def own_role_in(db: Session, account: Account, space_id: int) -> str | None:
    """The right the account has itself or through a team, without the operator's powers."""
    membership = db.get(Membership, (space_id, account.id))
    return higher(membership.role if membership is not None else None, _team_role(db, account.id, space_id))


def readable_ids(db: Session, account: Account) -> set[int]:
    """Every space the account may read."""
    live = set(db.scalars(select(Space.id).where(Space.deleted_at.is_(None))))
    if operator_powers(account):
        return live
    own = set(db.scalars(select(Membership.space_id).where(Membership.account_id == account.id)))
    own |= set(db.scalars(
        select(TeamGrant.space_id).join(TeamMember, TeamMember.team_id == TeamGrant.team_id)
        .where(TeamMember.account_id == account.id)
    ))
    if account.role == OPERATOR:
        with_members = set(db.scalars(select(Membership.space_id).distinct())) | set(
            db.scalars(select(TeamGrant.space_id).distinct())
        )
        own |= live - with_members
    own &= live
    if account.key_spaces is not None:
        own &= account.key_spaces
    return own


def check(db: Session, account: Account, space_id: int | None, need: str) -> Space:
    """The right ``need`` in the space, or ``RightsError``."""
    role = role_in(db, account, space_id)
    if not at_least(role, READ):
        raise RightsError("not_found", "Not found.", 404)
    if not at_least(role, need):
        raise RightsError("forbidden", "Your right in this space does not allow this.", 403)
    space = db.get(Space, space_id)
    assert space is not None
    return space


def board_for(db: Session, account: Account, board_id: str, need: str, *, deleted: bool = False) -> Board:
    """The board with the right ``need`` in its space, or ``RightsError``. A board in the bin counts only when
    ``deleted`` is asked for (the bin itself, restoring)."""
    board = db.get(Board, board_id)
    if board is None or (board.deleted_at is not None) != deleted:
        raise RightsError("not_found", "Not found.", 404)
    check(db, account, board.space_id, need)
    return board

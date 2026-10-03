"""The data model.

Everything lives in SQLite, except the photos and files put on boards: those lie as plain files in the media folder
(``services/media_store.py``), named by their id.

A board is a Yjs document (``services/boards.py``): what people change travels as small Yjs updates, which are kept
in ``board_updates`` until they are folded into the board's state. Next to the state the board keeps a plain JSON
picture of its items (``snapshot``), for the overview, the search, exports and the public page; the server writes it
from the state, the browser never sends it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, ClassVar

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(UTC)


class UtcDateTime(TypeDecorator[datetime]):
    """SQLite forgets the time zone. Stored as UTC, read back as UTC with the zone attached."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)


OPERATOR = "operator"
MEMBER = "member"
ROLES = (OPERATOR, MEMBER)

SIGN_IN_PASSWORD = "password"
SIGN_IN_OIDC = "oidc"

#: Rights in a space, each one including the ones before it: reading; writing (boards, the trash); managing
#: (inviting, giving rights, public pages, renaming or deleting the space).
READ = "read"
WRITE = "write"
MANAGE = "manage"
SPACE_ROLES = (READ, WRITE, MANAGE)


class Space(Base):
    """A place for boards, as in nexlore: its members and their rights decide who sees the boards in it."""

    __tablename__ = "spaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(16), default="#ff8a70")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    #: Set when a manager deleted the space; it lies in the bin with its boards for 30 days.
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


class Account(Base):
    """A person. The first account is the operator; the others come by invitation or through OIDC."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Lower case, the name people sign in with. What people see is the display name, when there is one.
    name: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(80), default="")
    #: The version whose "What's new" the account has read or put away.
    whats_new_seen: Mapped[str] = mapped_column(String(32), default="")
    role: Mapped[str] = mapped_column(String(16), default=MEMBER)
    sign_in: Mapped[str] = mapped_column(String(16), default=SIGN_IN_PASSWORD)
    #: Argon2id. Empty for accounts that sign in through OIDC only.
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    oidc_subject: Mapped[str] = mapped_column(String(255), default="")
    #: The interface language chosen in the account menu; empty: the browser's.
    language: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    #: The second factor (``services/totp.py``): the seed encrypted with the server secret, empty while off; the
    #: recovery codes as a JSON list of SHA-256 hashes; the time step of the last code taken (no replay).
    totp_secret_enc: Mapped[str] = mapped_column(Text, default="")
    totp_recovery: Mapped[str] = mapped_column(Text, default="")
    totp_last_step: Mapped[int] = mapped_column(Integer, default=0)
    #: The profile picture (``services/avatars.py``): a square WebP drawn anew, loaded only when asked for.
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    avatar_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    #: The account's own preferences (snapping, dots on the board, start page); only what it chose.
    preferences: Mapped[Any] = mapped_column(JSON, nullable=True)
    #: Not stored. Set on the account an API token acts as when the token may see only some spaces.
    key_spaces: ClassVar[frozenset[int] | None] = None
    #: Not stored. True on the account a token acts as: a program never has the operator's powers over other
    #: people's spaces, even when its account is the operator's.
    via_key: ClassVar[bool] = False


class AuthSession(Base):
    """A browser session. Only the hash of the token is stored; the token itself lives in the cookie."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")


class Membership(Base):
    """An account's right in a space. A space without any member belongs to the operator."""

    __tablename__ = "memberships"

    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=READ)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


TEAM_LOCAL = "local"
TEAM_ADMIN = "admin"
TEAM_SOURCES = (TEAM_LOCAL, TEAM_ADMIN)


class Team(Base):
    """People who work together (planning, design, the shop floor …). A team is not a space: a space says who may see
    what, a team says who works together. A space can give a team a right, and then everybody in the team has it.

    ``source`` says who keeps the members: nexcanvas itself, or later the family's admin app (``external_id`` is its
    id then). Only the source changes when that day comes, never the id. The same in every app of the family."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(16), default="#ff8a70")
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default=TEAM_LOCAL)
    #: The admin app's id for ``admin``.
    external_id: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class TeamMember(Base):
    __tablename__ = "team_members"

    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class TeamGrant(Base):
    """A team's right in a space: everybody in the team has it, next to any right of their own (the higher counts)."""

    __tablename__ = "team_grants"

    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=READ)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class Invite(Base):
    """A link that lets somebody in: into nexcanvas (a new account) and, when it names a space, into that space with a
    right. Only the hash of the token is stored; used once, then gone."""

    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True)
    #: The right in the space; empty for an invitation into nexcanvas only.
    space_role: Mapped[str] = mapped_column(String(16), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SpaceNotice(Base):
    """Something about a space an account should know or answer: an invitation by name (accepted or declined; nobody
    becomes a member without saying yes), or a change the operator made in a space it does not manage."""

    __tablename__ = "space_notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True)
    space_name: Mapped[str] = mapped_column(String(255), default="")
    #: ``invite``, or what the operator did: ``operator_added``, ``operator_role``, ``operator_removed``.
    kind: Mapped[str] = mapped_column(String(24))
    role: Mapped[str] = mapped_column(String(16), default="")
    actor: Mapped[str] = mapped_column(String(64), default="")
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    subject: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    done_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


class Board(Base):
    """A board in a space. Its content is a Yjs document: ``state`` holds it folded up to ``folded_seq``, the
    updates after that wait in ``board_updates``."""

    __tablename__ = "boards"

    #: Short and random, so addresses do not reveal how many boards there are.
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    #: Who changed it last, as a name (kept when the account goes).
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    state: Mapped[bytes] = mapped_column(LargeBinary, default=b"", deferred=True)
    folded_seq: Mapped[int] = mapped_column(Integer, default=0)
    #: The items and lines as plain JSON, written by the server from the state (see the module comment).
    snapshot: Mapped[Any] = mapped_column(JSON, nullable=True, deferred=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    #: Every word on the board, folded, for the search.
    words: Mapped[str] = mapped_column(Text, default="", deferred=True)


class BoardUpdate(Base):
    """One Yjs update, kept until it is folded into the board's state."""

    __tablename__ = "board_updates"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class BoardVersion(Base):
    """A board as it was, kept now and then while people work on it, to go back to."""

    __tablename__ = "board_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    #: The names of who changed the board since the version before.
    authors: Mapped[str] = mapped_column(String(500), default="")
    state: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)


class Media(Base):
    """A photo or file put on a board. The bytes lie in the media folder under the id; the space's rights apply."""

    __tablename__ = "media"
    __table_args__ = (Index("media_space_hash", "space_id", "sha256"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    #: What the content is, found from the bytes, never from the name.
    kind: Mapped[str] = mapped_column(String(16))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    pages: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class Favorite(Base):
    """A board an account starred."""

    __tablename__ = "favorites"

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class Visit(Base):
    """When an account last opened a board, for "Recent"."""

    __tablename__ = "visits"

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True)
    opened_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class Share(Base):
    """A public read-only page of a board: anybody with the link looks, nobody changes anything."""

    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: The secret part of the address. Kept, so the link can be copied again; it only ever opens this one board.
    token: Mapped[str] = mapped_column(String(64), unique=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), unique=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    #: Argon2id; empty: no password.
    password_hash: Mapped[str] = mapped_column(String(255), default="")


class ShapePackage(Base):
    """A package of shapes (block 4), installed for one space or, without a space, for the whole server. ``data`` is
    the package as ``services/shapepacks`` checked it; nothing else is ever kept."""

    __tablename__ = "shape_packages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True, index=True)
    data: Mapped[Any] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class BoardTemplate(Base):
    """A board kept as a starting point (block 5), for one space or, without a space, for the whole server. ``content``
    is the picture as ``services/boards`` checks a new board's content: items, lines, background, shapes."""

    __tablename__ = "board_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    content: Mapped[Any] = mapped_column(JSON)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class ApiToken(Base):
    """A token an account made for programs (``/api/v1``). Only the SHA-256 is stored."""

    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    #: ``read`` or ``write``.
    level: Mapped[str] = mapped_column(String(8))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(16))
    #: The ids of the spaces the token may see, of those its account may read; empty (None): all of them.
    spaces: Mapped[Any] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    warned_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


__all__ = [
    "MANAGE",
    "MEMBER",
    "OPERATOR",
    "READ",
    "ROLES",
    "SIGN_IN_OIDC",
    "SIGN_IN_PASSWORD",
    "SPACE_ROLES",
    "TEAM_ADMIN",
    "TEAM_LOCAL",
    "TEAM_SOURCES",
    "WRITE",
    "Account",
    "ApiToken",
    "AuthSession",
    "Base",
    "Board",
    "BoardTemplate",
    "BoardUpdate",
    "BoardVersion",
    "Favorite",
    "Invite",
    "Media",
    "Membership",
    "Setting",
    "ShapePackage",
    "Share",
    "Space",
    "SpaceNotice",
    "Team",
    "TeamGrant",
    "TeamMember",
    "Visit",
    "utcnow",
]

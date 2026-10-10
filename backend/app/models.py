"""The data model.

Everything lives in SQLite, except the photos and files put on boards: those lie as plain files in the media folder
(``services/media_store.py``), named by their id.

A board is a Yjs document (``services/boards.py``): what people change travels as small Yjs updates, which are kept
in ``board_updates`` until they are folded into the board's state. Next to the state the board keeps a plain JSON
picture of its items (``snapshot``), for the overview, the search, exports and the public page; the server writes it
from the state, the browser never sends it.
"""

from __future__ import annotations

import secrets
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
    UniqueConstraint,
    event,
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
    #: The space's id in nexsuite while nexcanvas is connected to it; its rights come from there then.
    external_id: Mapped[str] = mapped_column(String(40), default="")
    #: Set when a manager deleted the space; it lies in the bin with its boards for 30 days.
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    #: While connected: since when nexsuite no longer gives this app the space (its tick taken away, or deleted there
    #: after that). Its boards stay, only the operator sees it, marked, and may put it into the trash (B18).
    suite_dropped_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


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
    #: Where ``email`` came from: "" (an invitation, nexsuite, or from before this was kept) or ``provider`` (a sign-in
    #: provider's address). An address from a provider goes with the account's last link (the shared sign-in
    #: blueprint 01).
    email_source: Mapped[str] = mapped_column(String(16), default="")
    #: The address a provider knows the account by, offered on the account page to an account with a password (it
    #: takes it only when it says so); empty when there is nothing to offer. ``provider_email_off``: the address the
    #: account said "don't ask again" to.
    provider_email: Mapped[str] = mapped_column(String(255), default="")
    provider_email_off: Mapped[str] = mapped_column(String(255), default="")
    #: Before the sign-in provider list: the subject of the one provider of the settings, which became a link of the
    #: entry ``oidc`` (``oidc_links``) and stays readable for one version as the way back. While connected to nexsuite
    #: it holds the account's person there (``services/suite.py``), mirrored into the links of the coupled entry.
    oidc_subject: Mapped[str] = mapped_column(String(255), default="")
    #: The interface language chosen in the account menu; empty: the browser's.
    language: Mapped[str] = mapped_column(String(16), default="")
    #: The person in nexsuite this account belongs to (while connected) or belonged to before the last disconnect:
    #: connecting again to the same nexsuite suggests that person, so an account nexsuite once brought is not made a
    #: second time (Prüfgang B8). Empty for an account left out when connecting.
    suite_person: Mapped[str] = mapped_column(String(64), default="")
    #: While connected: the account's own link to a provider from before (authentik, Forgejo …), kept out of
    #: ``oidc_subject`` so its subject can never pass for a person in nexsuite (``3`` there is somebody else); given
    #: back on disconnecting (#job-172).
    oidc_subject_local: Mapped[str] = mapped_column(String(255), default="")
    #: The browser's language at the last sign-in (``de``, ``en``): what a mail to the account is written in while
    #: ``language`` is empty (Prüfgang 05.10.2026, decision 8).
    browser_language: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    #: Set when nexsuite blocked the person (or does not know it any more): no sign-in, sessions end at once.
    blocked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
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
    #: What the device cookies of this account are signed with (``security.device_token``): random per account, so
    #: an account made later under the id of a deleted one knows none of its browsers, and drawn anew on a new
    #: password, a block or unblock, "sign out everywhere" and a reset second factor, so no browser from before counts
    #: as known any more. Empty (accounts from before it existed): no device is known until the next sign-in.
    device_key: Mapped[str] = mapped_column(String(64), default="")
    #: The last "signed out everywhere" nexsuite reported for the person: a new moment forgets the known browsers.
    suite_signed_out: Mapped[str] = mapped_column(String(64), default="")
    #: Not stored. Set on the account an API token acts as when the token may see only some spaces.
    key_spaces: ClassVar[frozenset[int] | None] = None
    #: Not stored. True on the account a token acts as: a program never has the operator's powers over other
    #: people's spaces, even when its account is the operator's.
    via_key: ClassVar[bool] = False


def new_device_key() -> str:
    return secrets.token_urlsafe(24)


@event.listens_for(Account, "before_insert")
def _first_device_key(_mapper: Any, _connection: Any, target: Account) -> None:
    if not target.device_key:
        target.device_key = new_device_key()


@event.listens_for(Account.password_hash, "set")
@event.listens_for(Account.blocked_at, "set")
def _forget_devices(target: Account, value: Any, old: Any, _initiator: Any) -> None:
    """A new password, a block or an unblock: the browsers known before are not known any more, whatever the way it
    happens (here, by the operator, or from nexsuite)."""
    if value != old:
        target.device_key = new_device_key()


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


class OidcProvider(Base):
    """A sign-in provider (OpenID Connect), one row each; the columns as the shared sign-in blueprint names them. Read
    and written only through ``services/oidc_store.py`` for the shared module ``vendor/nexoidc``."""

    __tablename__ = "oidc_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Part of the callback address ``/api/oidc/<slug>/callback``; fixed once made.
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    #: The name on the sign-in button.
    label: Mapped[str] = mapped_column(String(64))
    #: Stored without blanks and without a slash at the end.
    issuer: Mapped[str] = mapped_column(String(500))
    client_id: Mapped[str] = mapped_column(String(255))
    #: Encrypted with the server secret under the context ``oidc-provider:<id>``; empty for a public client.
    client_secret_enc: Mapped[str] = mapped_column(Text, default="")
    scopes: Mapped[str] = mapped_column(String(500), default="openid profile email")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    #: "New people get an account": off from the start.
    auto_create: Mapped[bool] = mapped_column(Boolean, default=False)
    #: "The provider checks the second factor itself": on from the start.
    trusts_second_factor: Mapped[bool] = mapped_column(Boolean, default=True)
    #: "" by hand, "authentik" made by the authentik button, "nexsuite" from the coupling.
    managed: Mapped[str] = mapped_column(String(20), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    #: A callback path the provider knew before (a migration or a coupling sets it); "" is the standard one.
    redirect_path: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class OidcLink(Base):
    """One identity at one provider, bound to one account. Found only by ``(provider_id, subject)``, never by an
    address: ``email`` is for display."""

    __tablename__ = "oidc_links"
    __table_args__ = (
        UniqueConstraint("provider_id", "subject"),
        UniqueConstraint("provider_id", "account_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("oidc_providers.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    #: The ``iss`` of the token that made the link (with Entra ``common`` the real tenant).
    issuer: Mapped[str] = mapped_column(String(500))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


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
    #: ``invite``, or what the operator did: ``operator_added``, ``operator_role``, ``operator_removed``; and, without
    #: a space, ``operator_unlinked`` (it took the account's link to the provider named in ``subject``, routers/oidc).
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

"""nexcanvas' side of the shared sign-in module ``vendor/nexoidc``: the ``Store`` over its tables, the start-up
configuration, the address an account takes from a provider, and the migration from the single provider of the
settings to the list (also of an installation coupled to the directory service at that moment).

The module (the shared blueprint "Anmeldung mit OIDC und authentik") runs the protocol, decides who an identity is
and keeps the provider list; it never sees a database. What is nexcanvas' own lives here: accounts and their names,
the rights an invitation brings into a space, the address an account takes from its provider, and the encryption of
the client secrets with the server secret.

A ``SqlStore`` works inside one SQLAlchemy session, one request. The module commits when an outcome is settled and
rolls back when it refuses after a write (a consumed invitation comes back that way). A store made with ``hold``
only flushes where the module commits: its caller commits once, together with what it writes itself (connecting to
the directory service, the migration).
"""

from __future__ import annotations

import logging
import re
import unicodedata

from sqlalchemy import delete, event, func, select, update
from sqlalchemy.orm import Session

from .. import __version__
from ..config import get_settings
from ..db import SessionLocal
from ..models import (
    MEMBER,
    SIGN_IN_OIDC,
    SIGN_IN_PASSWORD,
    Account,
    OidcLink,
    OidcProvider,
    Setting,
    utcnow,
)
from ..models import Invite as InviteRow
from ..security import decrypt_secret, encrypt_secret
from ..vendor import nexoidc
from ..vendor.nexoidc import (
    MANAGED_NEXSUITE,
    AccountState,
    Invite,
    Link,
    Provider,
    ProviderValues,
    coupling,
    migrate,
    protocol,
    secret_context,
)
from . import accounts, settings_service

logger = logging.getLogger("nexcanvas.oidc")

APP_NAME = "nexcanvas"
#: Where nexcanvas' sign-in and account pages are, as the module sends the browser there.
LOGIN_PAGE = "/login"
ACCOUNT_PAGE = "/account"
HOME = "/"
#: Longest account name (``accounts.NAME_PATTERN``).
NAME_MAX = 64
_NUMBERED = re.compile(r"^(.*?)(-\d+)$")
#: Where ``Account.email`` came from when a provider gave it.
FROM_PROVIDER = "provider"


def _public_url() -> str:
    with SessionLocal() as db:
        return settings_service.public_url(db)


def save_public_url(url: str) -> None:
    """The address the operator confirmed in the authentik card becomes the public address (the setting
    ``public_url`` reads first), in a transaction of its own and committed at once: it outlives a restart, and a run
    of the button that fails later keeps it."""
    with SessionLocal() as db:
        settings_service.save(db, {"public_url": url})


def _server_secret() -> str:
    return get_settings().resolved_secret_key()


def configure() -> None:
    """Tell the module who it runs in; called once at start-up (and by the tests)."""
    nexoidc.configure(
        nexoidc.AppConfig(
            app_name=APP_NAME,
            server_secret=_server_secret,
            public_url=_public_url,
            save_public_url=save_public_url,
            login_page=LOGIN_PAGE,
            account_page=ACCOUNT_PAGE,
            home=HOME,
            # Two instances on one host (say :8500 and :8505) keep their attempts apart, as their sessions.
            cookie_suffix=get_settings().cookie_name_suffix(),
        )
    )


def clean_name(raw: str) -> str:
    """An account name from what the provider suggests: lower case, nexcanvas' characters, at most 64; a number at
    the end (``max-2``) survives the cut. Empty when nothing usable is left."""
    cleaned = re.sub(r"[^a-z0-9._-]", "-", raw.strip().lower()).strip("-._")
    if len(cleaned) > NAME_MAX:
        numbered = _NUMBERED.match(cleaned)
        suffix = numbered.group(2) if numbered else ""
        stem = numbered.group(1) if numbered else cleaned
        cleaned = stem[: NAME_MAX - len(suffix)].rstrip("-._") + suffix
    return cleaned if accounts.NAME_PATTERN.match(cleaned) else ""


def provider_only(account: Account) -> bool:
    """The account signs in through a provider only (no password of its own here)."""
    return account.sign_in == SIGN_IN_OIDC or not account.password_hash


def clean_address(value: str | None) -> str:
    """A provider's address as nexcanvas keeps addresses: one line, no control or format characters, the form of
    ``accounts.EMAIL_PATTERN``, at most 255 characters; "" when it is none of that."""
    text = str(value or "").strip()
    if not text or len(text) > 255 or any(unicodedata.category(char) in ("Cc", "Cf") for char in text):
        return ""
    return text if accounts.EMAIL_PATTERN.match(text) else ""


def address_taken(db: Session, address: str, own_id: int) -> bool:
    """Another account has this address already: a provider's address never moves to a second account."""
    found = db.scalar(
        select(Account.id).where(func.lower(Account.email) == address.lower(), Account.id != own_id).limit(1)
    )
    return found is not None


def take_address(db: Session, account: Account, address: str) -> bool:
    """The provider's address becomes the account's own (followed, or taken from the offer). False when another
    account has it."""
    if address_taken(db, address, account.id):
        logger.warning("Provider address not taken, another account has it name=%s address=%s",
                       account.name, protocol.masked(address))
        return False
    account.email = address
    account.email_source = FROM_PROVIDER
    account.provider_email = ""
    return True


def from_provider(db: Session, account: Account, raw: str | None) -> None:
    """What a provider says about the address at a sign-in or a link (the caller commits). ``email_verified`` is
    never read (the shared sign-in module): the address finds nobody, it is only what the account is mailed at. An
    account through providers only follows it; every other account is offered it on its account page and takes it
    only when it says so. Never an address another account has."""
    address = clean_address(raw)
    if not address:
        return
    if account.email and account.email.lower() == address.lower():
        account.provider_email = ""
        return
    if provider_only(account):
        take_address(db, account, address)
        return
    account.provider_email = address


def offered_address(db: Session, account: Account) -> str:
    """The address the account page offers: one a provider knows, other than the own, not refused, nobody else's."""
    offer = account.provider_email
    if not offer or (account.email and account.email.lower() == offer.lower()):
        return ""
    if account.provider_email_off and account.provider_email_off.lower() == offer.lower():
        return ""
    return "" if address_taken(db, offer, account.id) else offer


def _own_links(db: Session, account_id: int) -> bool:
    """The account still has a link to a provider of its own (the coupled directory service entry does not count: the
    address of an account in the directory service is the directory service's)."""
    found = db.scalar(
        select(OidcLink.id)
        .join(OidcProvider, OidcProvider.id == OidcLink.provider_id)
        .where(OidcLink.account_id == account_id, OidcProvider.managed != MANAGED_NEXSUITE)
        .limit(1)
    )
    return found is not None


def has_own_links(db: Session, account_id: int) -> bool:
    """The account can sign in through a provider of its own (not the coupled directory service entry)."""
    return _own_links(db, account_id)


def links_gone(db: Session, account_id: int) -> None:
    """No provider of its own left for the account: an address that came from one goes too (also the offer), an own
    one stays. Not while another link holds."""
    if _own_links(db, account_id):
        return
    account = db.get(Account, account_id)
    if account is None:
        return
    if account.email_source == FROM_PROVIDER:
        account.email = ""
        account.email_source = ""
    account.provider_email = ""
    account.provider_email_off = ""


#: Set on a session when the entry ``oidc`` or a link changed: the way back to 0.3 is written before its commit.
TOUCHED = "nexoidc_touched"


def touched(db: Session) -> None:
    db.info[TOUCHED] = True


class SqlStore:
    """``nexoidc.Store`` over ``oidc_providers`` and ``oidc_links``, inside one session."""

    def __init__(self, db: Session, *, hold: bool = False) -> None:
        self.db = db
        self.hold = hold

    # --- Providers -------------------------------------------------------------------------------------------------

    def _provider(self, row: OidcProvider | None) -> Provider | None:
        if row is None:
            return None
        return Provider(
            id=row.id,
            slug=row.slug,
            label=row.label,
            issuer=row.issuer,
            client_id=row.client_id,
            client_secret=decrypt_secret(row.client_secret_enc, secret_context(row.id)),
            scopes=row.scopes,
            enabled=row.enabled,
            auto_create=row.auto_create,
            trusts_second_factor=row.trusts_second_factor,
            managed=row.managed,
            position=row.position,
            redirect_path=row.redirect_path,
            created_at=row.created_at,
            registered_redirect=row.registered_redirect or "",
        )

    def list_providers(self) -> list[Provider]:
        rows = self.db.scalars(select(OidcProvider).order_by(OidcProvider.position, OidcProvider.id))
        return [provider for provider in (self._provider(row) for row in rows) if provider is not None]

    def get_provider(self, provider_id: int) -> Provider | None:
        return self._provider(self.db.get(OidcProvider, provider_id))

    def provider_by_slug(self, slug: str) -> Provider | None:
        return self._provider(self.db.scalar(select(OidcProvider).where(OidcProvider.slug == slug)))

    @staticmethod
    def _apply(row: OidcProvider, values: ProviderValues) -> None:
        row.slug, row.label, row.issuer, row.client_id = values.slug, values.label, values.issuer, values.client_id
        row.scopes, row.enabled, row.auto_create = values.scopes, values.enabled, values.auto_create
        row.trusts_second_factor, row.managed, row.position = (
            values.trusts_second_factor,
            values.managed,
            values.position,
        )
        row.redirect_path = values.redirect_path
        if values.registered_redirect is not None:
            # None keeps what the button registered last; only the button writes it.
            row.registered_redirect = values.registered_redirect

    def insert_provider(self, values: ProviderValues) -> Provider:
        touched(self.db)
        row = OidcProvider()
        self._apply(row, values)
        self.db.add(row)
        self.db.flush()
        row.client_secret_enc = encrypt_secret(values.client_secret or "", secret_context(row.id))
        self.db.flush()
        provider = self._provider(row)
        assert provider is not None
        return provider

    def update_provider(self, provider_id: int, values: ProviderValues) -> Provider:
        touched(self.db)
        row = self.db.get(OidcProvider, provider_id)
        assert row is not None
        self._apply(row, values)
        if values.client_secret is not None:
            row.client_secret_enc = encrypt_secret(values.client_secret, secret_context(row.id))
        self.db.flush()
        provider = self._provider(row)
        assert provider is not None
        return provider

    def delete_provider(self, provider_id: int) -> None:
        # Foreign keys are on (db.py), the links would go anyway; said here so that nothing depends on a pragma, and
        # so that an address that came with the last of an account's links goes along.
        touched(self.db)
        self.drop_links(provider_id)
        self.db.execute(delete(OidcProvider).where(OidcProvider.id == provider_id))
        self.db.flush()

    def _coupled_entry(self, provider_id: int) -> bool:
        row = self.db.get(OidcProvider, provider_id)
        return row is not None and row.managed == MANAGED_NEXSUITE

    # --- Links -----------------------------------------------------------------------------------------------------

    @staticmethod
    def _link(row: OidcLink) -> Link:
        return Link(row.provider_id, row.subject, row.account_id, row.issuer, row.email, row.created_at,
                    row.last_used_at)

    def find_link(self, provider_id: int, subject: str) -> Link | None:
        row = self.db.scalar(select(OidcLink).where(OidcLink.provider_id == provider_id, OidcLink.subject == subject))
        return self._link(row) if row else None

    def links_of_provider(self, provider_id: int) -> list[Link]:
        rows = self.db.scalars(select(OidcLink).where(OidcLink.provider_id == provider_id).order_by(OidcLink.id))
        return [self._link(row) for row in rows]

    def links_of_account(self, account_id: int) -> list[Link]:
        rows = self.db.scalars(select(OidcLink).where(OidcLink.account_id == account_id).order_by(OidcLink.id))
        return [self._link(row) for row in rows]

    def add_link(self, link: Link) -> None:
        touched(self.db)
        self.db.add(OidcLink(provider_id=link.provider_id, subject=link.subject, account_id=link.account_id,
                             issuer=link.issuer, email=link.email))
        self.db.flush()
        self._address(link.provider_id, link.account_id, link.email)

    def remove_link(self, provider_id: int, account_id: int) -> bool:
        touched(self.db)
        result = self.db.execute(
            delete(OidcLink).where(OidcLink.provider_id == provider_id, OidcLink.account_id == account_id)
        )
        removed = bool(result.rowcount)  # type: ignore[attr-defined]
        if removed:
            self.db.flush()
            if not self._coupled_entry(provider_id):
                links_gone(self.db, account_id)
        return removed

    def drop_links(self, provider_id: int) -> int:
        touched(self.db)
        holders = set(self.db.scalars(select(OidcLink.account_id).where(OidcLink.provider_id == provider_id)))
        coupled = self._coupled_entry(provider_id)
        result = self.db.execute(delete(OidcLink).where(OidcLink.provider_id == provider_id))
        self.db.flush()
        for account_id in holders if not coupled else ():
            links_gone(self.db, account_id)
        return int(result.rowcount or 0)  # type: ignore[attr-defined]

    def touch_link(self, provider_id: int, subject: str, email: str | None) -> None:
        self.db.execute(
            update(OidcLink)
            .where(OidcLink.provider_id == provider_id, OidcLink.subject == subject)
            .values(last_used_at=utcnow(), email=email)
        )
        account_id = self.db.scalar(
            select(OidcLink.account_id).where(OidcLink.provider_id == provider_id, OidcLink.subject == subject)
        )
        if account_id is not None:
            self._address(provider_id, account_id, email)

    def _address(self, provider_id: int, account_id: int, email: str | None) -> None:
        """What the provider says about the address treats it (``from_provider``). Not for the coupled
        the directory service entry: the address of an account in the directory service comes with the directory
        (``services/suite.py``)."""
        if not email or self._coupled_entry(provider_id):
            return
        account = self.db.get(Account, account_id)
        if account is not None:
            from_provider(self.db, account, email)

    # --- Accounts --------------------------------------------------------------------------------------------------

    def account_state(self, account_id: int) -> AccountState | None:
        row = self.db.get(Account, account_id)
        if row is None:
            return None
        return AccountState(
            id=row.id,
            name=row.name,
            # Blocked by the operator, or by the directory service while connected: no way in through a provider either.
            blocked=row.blocked_at is not None,
            has_password=row.sign_in == SIGN_IN_PASSWORD and bool(row.password_hash),
            has_second_factor=bool(row.totp_secret_enc),
        )

    def clean_name(self, raw: str) -> str:
        return clean_name(raw)

    def name_taken(self, name: str) -> bool:
        return accounts.by_name(self.db, name) is not None

    def create_account(self, name: str, *, invite: Invite | None, email: str | None) -> int:
        row = Account(name=name, role=MEMBER, sign_in=SIGN_IN_OIDC, password_hash="", whats_new_seen=__version__)
        self.db.add(row)
        self.db.flush()
        address = clean_address(email)
        if address:
            # Through the provider only: the account follows its address (never one another account has).
            take_address(self.db, row, address)
        if invite is not None and isinstance(invite.rights, InviteRow):
            invitation = invite.rights
            if not row.email and invitation.email and not address_taken(self.db, invitation.email, row.id):
                # The address the invitation went to, when the provider gave none: as with a password.
                row.email = invitation.email
            accounts.redeem(self.db, invitation, row, consumed=True, commit=False)
        logger.info("Account created name=%s role=%s sign_in=oidc", row.name, MEMBER)
        return row.id

    # --- Invitations -----------------------------------------------------------------------------------------------

    def find_invite(self, key: str) -> Invite | None:
        from . import suite

        if suite.connected(self.db):
            # Connected, accounts come from the directory service: an old invitation is no way in.
            return None
        row = accounts.find_invite(self.db, key)
        return Invite(key=key, id=row.id, rights=row) if row is not None else None

    def consume_invite(self, invite: Invite) -> bool:
        row = invite.rights
        return isinstance(row, InviteRow) and accounts.consume(self.db, row)

    def accept_invite(self, account_id: int, invite: Invite) -> None:
        """A known identity that came through an invitation: the invitation's right in its space comes on top of what
        the account has (raised, never lowered); the invitation is used up already (``consume_invite``)."""
        row = invite.rights
        account = self.db.get(Account, account_id)
        if account is not None and isinstance(row, InviteRow):
            accounts.redeem(self.db, row, account, consumed=True, commit=False)

    # --- Transaction -----------------------------------------------------------------------------------------------

    def commit(self) -> None:
        if self.hold:
            self.db.flush()
        else:
            self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()


def linked_providers(db: Session) -> dict[int, list[dict[str, object]]]:
    """Per account the providers it is linked to, in the order of the list (marks in the operator's account list)."""
    linked: dict[int, list[dict[str, object]]] = {}
    for link, entry in db.execute(
        select(OidcLink, OidcProvider)
        .join(OidcProvider, OidcProvider.id == OidcLink.provider_id)
        .order_by(OidcProvider.position, OidcProvider.id)
    ):
        linked.setdefault(link.account_id, []).append(
            {"id": entry.id, "slug": entry.slug, "label": entry.label, "managed": entry.managed}
        )
    return linked


# --- The migration from the single provider of the settings --------------

#: The settings of the single provider before the list. They stay readable for one version (the way back), then go.
LEGACY_KEYS = ("oidc_issuer", "oidc_client_id", "oidc_client_secret_enc", "oidc_provider_name", "oidc_auto_create")
#: Set once the settings were looked at: an operator who later removes every entry must not get the old provider
#: back at the next start.
MIGRATED = "oidc_list_migrated"
#: What the way back said when the app last wrote it (``migrate.fingerprint``): only sums, no secret, no subject.
FINGERPRINT = "oidc_legacy_fingerprint"
#: The issuer 0.3 knows, or ``migrate.CLOSED`` (module 1.0.10): with the entry ``oidc`` it decides what the way back
#: shows (``migrate.way_back``). nexcanvas only stores it.
ANCHOR = "oidc_legacy_anchor"
#: The copy of the old settings that was kept next to the entry (never shipped; a development database may still have
#: the row): nothing reads it, the start removes it.
HELD_COPY = "oidc_way_back_held"
#: nexcanvas asked no code after the provider before the list: the migrated entries keep that.
TRUSTED_BEFORE = True


def _legacy(values: dict[str, object]) -> migrate.Legacy:
    label = str(values.get("oidc_provider_name") or "")
    return migrate.Legacy(
        issuer=str(values.get("oidc_issuer") or ""),
        client_id=str(values.get("oidc_client_id") or ""),
        client_secret=decrypt_secret(str(values.get("oidc_client_secret_enc") or "")),
        label=label,
        auto_create=bool(values.get("oidc_auto_create")),
        # The authentik button of nexcanvas 0.1 to 0.3 named the provider "authentik"; the form never did by itself.
        set_up_by_button=label == "authentik",
    )


def legacy_plan(db: Session) -> migrate.Plan | None:
    """The entry ``oidc`` and its links the old settings become (on its own); None when no provider was set up."""
    subjects = [
        (account_id, subject)
        for account_id, subject in db.execute(
            select(Account.id, Account.oidc_subject).where(Account.oidc_subject != "").order_by(Account.id)
        )
    ]
    return migrate.plan(_legacy(settings_service.get_all(db)), subjects, trusts_second_factor=TRUSTED_BEFORE)


def _coupled_now(db: Session) -> bool:
    from . import suite

    return suite.connected(db)


def migration_due(db: Session) -> bool:
    if settings_service.get(db, MIGRATED) or db.scalar(select(func.count()).select_from(OidcProvider)):
        return False
    if _coupled_now(db):
        return bool(settings_service.get(db, "oidc_issuer") and settings_service.get(db, "oidc_client_id"))
    return legacy_plan(db) is not None


#: Persons of the directory service a coupled 0.3 left with more than one account claiming them (never settled under
#: 0.3): ``{person: [account ids]}``, decided by the first directory fetch.
UNSETTLED = "suite_unsettled"


def _persons_of_0_3(db: Session) -> tuple[list[tuple[int, str]], dict[str, list[int]]]:
    """Who 0.3 had as each person: the pairs to link at once, and the persons claimed by several accounts. A person
    goes to the one account marked with it (``suite_person``, the operator's choice when connecting) or to the one
    unmarked account not blocked that holds it; with more than one, or only blocked ones, nobody wins by order: the
    directory's sign-in name decides later (``suite.settle_unsettled``), as 0.3's own sync did first."""
    holders: dict[str, list[Account]] = {}
    for row in db.scalars(select(Account).where(Account.oidc_subject != "").order_by(Account.id)):
        holders.setdefault(row.oidc_subject, []).append(row)
    people: list[tuple[int, str]] = []
    unsettled: dict[str, list[int]] = {}
    for subject, rows in holders.items():
        marked = [row for row in rows if row.suite_person == subject]
        if len(marked) == 1:
            people.append((marked[0].id, subject))
            continue
        unmarked = [row for row in rows if not row.suite_person]
        if len(marked) > 1:
            unsettled[subject] = [row.id for row in marked]
        elif len(unmarked) == 1 and unmarked[0].blocked_at is None:
            people.append((unmarked[0].id, subject))
        elif unmarked:
            unsettled[subject] = [row.id for row in unmarked]
    return people, unsettled


def _apply_coupled(db: Session) -> coupling.Coupling | None:
    """An installation connected to the directory service at the moment of the update: the own provider from before
    connecting (``suite_saved``) becomes the entry ``oidc`` with the own links (``oidc_subject_local``), set aside at
    once; the directory service (the settings now) becomes the coupled entry with the accounts' persons
    (``oidc_subject``)."""
    from . import suite

    values = settings_service.get_all(db)
    saved = values.get("suite_saved") if isinstance(values.get("suite_saved"), dict) else {}
    own = _legacy(saved) if saved and saved.get("oidc_issuer") and saved.get("oidc_client_id") else None
    nexsuite = _legacy({**values, "oidc_provider_name": "nexsuite"})
    people, unsettled = _persons_of_0_3(db)
    own_subjects = [
        (row.id, row.oidc_subject_local)
        for row in db.scalars(select(Account).where(Account.oidc_subject_local != "").order_by(Account.id))
    ]
    # The anchor first: the commit of ``apply_coupled`` is the first one that could write the way back.
    settings_service.save(db, {ANCHOR: migrate.anchor_of(own)}, commit=False)
    if unsettled:
        # Settled at the first fetch of the directory (``suite._apply``), by the person's sign-in name only.
        settings_service.save(db, {UNSETTLED: unsettled}, commit=False)
        logger.warning("OIDC: %d persons of nexsuite have more than one account here; the directory decides",
                       len(unsettled))
    return migrate.apply_coupled(
        SqlStore(db, hold=True),
        nexsuite=nexsuite,
        own=own,
        people=people,
        own_subjects=own_subjects,
        trusts_second_factor=TRUSTED_BEFORE,
        label=suite.ENTRY_LABEL,
    )


def migrate_settings(*, backup: bool = True) -> Provider | None:
    """The whole start-up of the sign-in: once, at the first start with the list, the provider of the settings becomes
    the entry ``oidc`` with a link per stored subject (``/api/oidc/callback`` keeps signing in; connected to the
    directory service, the directory service becomes the coupled entry and the own provider waits set aside; a backup
    goes first, the way back). At every start, what 0.3 changed in its settings and its column while the app ran there
    is taken over (``migrate.resync``); then the way back is written again, always, and its fingerprint stored. The
    entry ``oidc`` is returned when this start made it (the coupled one while connected), else None."""
    _drop_held_copy()
    migrated = _migrate_once(backup)
    up_again(backup=backup)
    if not migrated:
        return None
    with SessionLocal() as db:
        return SqlStore(db).provider_by_slug(nexoidc.LEGACY_SLUG)


def _drop_held_copy() -> None:
    with SessionLocal() as db:
        row = db.get(Setting, HELD_COPY)
        if row is not None:
            db.delete(row)
            db.commit()


def _migrate_once(backup: bool) -> bool:
    with SessionLocal() as db:
        if not migration_due(db):
            if not settings_service.get(db, MIGRATED):
                # No provider to move: the way back starts closed, and a provider 0.3 sets up later comes in through
                # ``resync`` (which opens it).
                settings_service.save(db, {MIGRATED: True, ANCHOR: migrate.CLOSED})
            return False
    if backup:
        from . import backups

        backups.create(kind=backups.UPDATE, note="before the sign-in provider list")
    with SessionLocal() as db:
        if not migration_due(db):
            return False
        if _coupled_now(db):
            joined = _apply_coupled(db)
            # One transaction with the list: the coupling is kept for uncoupling, or nothing is.
            settings_service.save(db, {MIGRATED: True, "suite_coupling": joined.as_dict() if joined else None})
            logger.warning("OIDC: the coupled installation moved to the provider list")
        else:
            # The anchor first: the commit inside ``apply`` writes the way back, and it must see it.
            plan = legacy_plan(db)
            settings_service.save(db, {ANCHOR: migrate.anchor_of(read_legacy(db)[0])}, commit=False)
            migrate.apply(SqlStore(db, hold=True), plan)
            settings_service.save(db, {MIGRATED: True})
    return True


# --- The way back to 0.3 and up again (module README "Rückweg und wieder hoch") ---------------------------------------


def read_legacy(db: Session) -> tuple[migrate.Legacy, list[tuple[int, str]]]:
    """The old settings and the old column, read the one way the migration, the fingerprint and ``resync`` read them
    (the secret decrypted)."""
    subjects = [
        (account_id, subject)
        for account_id, subject in db.execute(
            select(Account.id, Account.oidc_subject).where(Account.oidc_subject != "").order_by(Account.id)
        )
    ]
    return _legacy(settings_service.get_all(db)), subjects


def _coupled_entries(db: Session) -> bool:
    return db.scalar(select(OidcProvider.id).where(OidcProvider.managed == MANAGED_NEXSUITE).limit(1)) is not None


def mirror_way_back(db: Session) -> None:
    """The way back to 0.3: what the old settings and the column show is ``migrate.way_back``'s (one rule in the
    module: the entry ``oidc`` and the stored anchor decide). nexcanvas writes it in the old form, stores the anchor
    that comes back, and then the fingerprint of what it reads back (``resync`` compares it at the next start). Called
    at every commit that touched the entry, a link or an account (``_write_the_way_back``) and at every start.
    **Not** before the migration (the settings and the column are still 0.3's own and wait to be read) and **not**
    coupled to the directory service (they say what 0.3 would have written, ``services/suite.py``; the anchor stays as
    it is). Flushes; the caller commits."""
    db.flush()
    if not settings_service.get(db, MIGRATED) or _coupled_entries(db):
        return
    store = SqlStore(db)
    entry = store.provider_by_slug(nexoidc.LEGACY_SLUG)
    links = [(link.account_id, link.subject) for link in store.links_of_provider(entry.id)] if entry else []
    mirror = migrate.way_back(entry, links, str(settings_service.get(db, ANCHOR) or "") or None)
    secret = mirror.legacy.client_secret
    kept = str(settings_service.get(db, "oidc_client_secret_enc") or "")
    # Sealed afresh only when it changed: the same secret would give another text each time.
    sealed = "" if not secret else (kept if kept and decrypt_secret(kept) == secret else encrypt_secret(secret))
    settings_service.save(
        db,
        {
            "oidc_issuer": mirror.legacy.issuer,
            "oidc_client_id": mirror.legacy.client_id,
            "oidc_client_secret_enc": sealed,
            "oidc_provider_name": mirror.legacy.label,
            "oidc_auto_create": bool(mirror.legacy.auto_create),
            ANCHOR: mirror.anchor,
        },
        commit=False,
    )
    for account in db.scalars(
        select(Account).where((Account.oidc_subject != "") | Account.id.in_(list(mirror.subjects)))
    ):
        wanted = mirror.subjects.get(account.id, "")
        if account.oidc_subject != wanted:
            account.oidc_subject = wanted
    db.flush()
    legacy, subjects = read_legacy(db)
    settings_service.save(db, {FINGERPRINT: migrate.fingerprint(legacy, subjects)}, commit=False)


def up_again(*, backup: bool = True) -> None:
    """At every start after the migration: take over what 0.3 changed since the fingerprint of the last time (and
    nothing else; a backup goes first when there is something), then write the way back again, always, also without
    a single provider, and store the new fingerprint. Without a stored fingerprint (the first start of this version)
    nothing is taken over. Coupled to the directory service nothing is taken over either: the list changes through the
    coupling only; the start says so (info) instead of the module's warning at every start, and the anchor stays."""
    with SessionLocal() as db:
        legacy, subjects = read_legacy(db)
        previous = str(settings_service.get(db, FINGERPRINT) or "") or None
        coupled = _coupled_entries(db)
        found = migrate.changes_since(previous, legacy, subjects)
    if coupled:
        _keep_anchor_coupled()
        if found.any:
            logger.info("OIDC: coupled to nexsuite, what 0.3 changed in its sign-in settings is not taken over")
        return
    if found.any and backup:
        from . import backups

        backups.create(kind=backups.UPDATE, note="before taking over the old sign-in settings")
    with SessionLocal() as db:
        legacy, subjects = read_legacy(db)

        def keep_anchor(value: str) -> None:
            settings_service.save(db, {ANCHOR: value}, commit=False)

        migrate.resync(
            SqlStore(db, hold=True), legacy, subjects, previous=previous, trusts_second_factor=TRUSTED_BEFORE,
            anchor=str(settings_service.get(db, ANCHOR) or "") or None, keep_anchor=keep_anchor,
        )
        mirror_way_back(db)
        db.commit()


def _keep_anchor_coupled() -> None:
    """Coupled the anchor outlives the coupling: the stored one stays; a database that has none (migrated before
    1.0.10) gets it closed, as ``resync`` would derive it for the entry of the directory service."""
    with SessionLocal() as db:
        if not settings_service.get(db, ANCHOR):
            settings_service.save(db, {ANCHOR: migrate.CLOSED})


@event.listens_for(Session, "before_flush")
def _note_changes(session: Session, _context: object, _instances: object) -> None:
    """A change the store does not make itself: an entry or a link changed by the ORM, an account deleted (its links
    go with it). The column of 0.3 is not watched: nothing here writes it but the mirror; a change there is 0.3's."""
    for item in (*session.new, *session.dirty, *session.deleted):
        if isinstance(item, OidcProvider | OidcLink) or (isinstance(item, Account) and item in session.deleted):
            session.info[TOUCHED] = True
            return


@event.listens_for(Session, "before_commit")
def _write_the_way_back(session: Session) -> None:
    # What is still waiting is flushed first: the changes are seen at the flush, which comes after this event.
    session.flush()
    if session.info.pop(TOUCHED, False):
        mirror_way_back(session)
        # Its own writes are no change of the entry.
        session.info.pop(TOUCHED, None)

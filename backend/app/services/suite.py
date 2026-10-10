"""nexcanvas hung on nexsuite: connecting, keeping the directory in step, running on its own again.

The contract is nexsuite's ``docs/connect.md``. In short:

* **Connecting** (the operator, here): the address of nexsuite and a one-time code made there. nexcanvas sends the code
  with its own address and gets a client for signing in through nexsuite and a token to fetch the directory. Then the
  operator matches every account here to a person there (or a new one), every space to a space there (or a new one),
  and the local teams go along. Only then nexcanvas counts as connected: from now on people sign in through nexsuite.
* **Keeping in step**: nexcanvas fetches the directory once a minute and whenever nexsuite says something changed
  (``POST /api/suite/event``, signed with the token). Accounts follow their person (``oidc_subject`` = the person's id),
  teams and spaces follow theirs (``external_id``). A blocked person is signed out at once. A space nexsuite no longer
  gives this app keeps its boards, but nobody but the operator sees it.
* **What is kept there** cannot be changed here: accounts, teams, rights in spaces from nexsuite, sign-in, mail.
* **The way back**: the operator disconnects here (nexsuite forgets the app), or nexsuite disconnects the app, or, with
  nexsuite out of reach, an emergency code does it. nexcanvas keeps everything it got and runs on its own again: the
  operator's own sign-in with password stays throughout (the emergency account).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import __version__
from ..models import (
    MEMBER,
    OPERATOR,
    SIGN_IN_OIDC,
    SIGN_IN_PASSWORD,
    SPACE_ROLES,
    TEAM_ADMIN,
    TEAM_LOCAL,
    Account,
    AuthSession,
    Membership,
    OidcLink,
    OidcProvider,
    Space,
    SpaceNotice,
    Team,
    TeamGrant,
    TeamMember,
    new_device_key,
    utcnow,
)
from ..security import decrypt_secret, encrypt_secret, end_all_sessions
from ..vendor.nexoidc import MANAGED_NEXSUITE, coupling, providers
from . import accounts, logs, settings_service

logger = logging.getLogger("nexcanvas.suite")

KIND = "nexcanvas"
#: What nexcanvas takes from nexsuite. Links between the apps come later; until then they are not claimed.
CAPABILITIES = ["people", "teams", "spaces", "mail"]
TIMEOUT = 10.0
#: A notice older than this is refused (against a notice caught and sent again later).
NOTICE_SECONDS = 300
TOKEN_CONTEXT = "suite-token"
SECRET_CONTEXT = "oidc-client-secret"
SMTP_KEYS = ("smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_password_enc", "smtp_from")
OIDC_KEYS = ("oidc_issuer", "oidc_client_id", "oidc_client_secret_enc", "oidc_provider_name", "oidc_auto_create")
#: The name on the button of the coupled entry in the provider list (the app decides it, blueprint 06).
ENTRY_LABEL = "nexsuite"

_sync_lock = threading.RLock()
#: Keeping the choices of a connection under way and finishing it do not cross (B23); two finishes neither.
_connect_lock = threading.RLock()
#: What nexsuite answers to a pairing; anything else came from something that is not nexsuite (B24).
PAIR_CODES = frozenset({"pair_code_invalid", "too_many_attempts", "invalid_url", "unknown_app", "suite_unreachable",
                        # An older connection of this address that still holds, or that nexsuite cannot ask about.
                        "app_still_connected", "app_not_reachable"})
#: Set by the tests: a notice fetches the directory before it answers.
INLINE = False


class SuiteError(Exception):
    def __init__(self, code: str, text: str, status: int = 502, http: int = 0) -> None:
        super().__init__(text)
        #: ``http``: the status nexsuite (or whatever answered) gave, when it answered at all.
        self.code, self.text, self.status, self.http = code, text, status, http


# --- State ------------------------------------------------------------------------------------------------------------


def state(db: Session) -> str:
    """``""`` (on its own), ``connecting`` or ``connected``."""
    return str(settings_service.get(db, "suite_state") or "")


def connected(db: Session) -> bool:
    return state(db) == "connected"


def _token(db: Session) -> str:
    stored = str(settings_service.get(db, "suite_token_enc") or "")
    return decrypt_secret(stored, TOKEN_CONTEXT) if stored else ""


def operators_from_suite(db: Session) -> list[Account]:
    """The operators here whose role came from nexsuite only: they were none before connecting, or were made while
    connected (B17, decided 05.10.2026). Never the emergency account. A connection from before the roles were kept
    names nobody: what they were is not known."""
    saved = settings_service.get(db, "suite_saved") or {}
    roles = saved.get("roles") if isinstance(saved, dict) else None
    if not isinstance(roles, dict) or not connected(db):
        return []
    keeper = int(settings_service.get(db, "suite_emergency_account") or 0)
    return [row for row in db.scalars(select(Account).where(Account.role == OPERATOR).order_by(Account.name))
            if row.id != keeper and roles.get(str(row.id)) != OPERATOR]


def roles_kept(db: Session) -> bool:
    """Whether the connection kept the roles from before it (made since B17). Without them a disconnect changes no
    role, and the dialog says so and names the operators who stay (``operators_staying``)."""
    saved = settings_service.get(db, "suite_saved") or {}
    return isinstance(saved, dict) and isinstance(saved.get("roles"), dict)


def operators_staying(db: Session) -> list[Account]:
    """A connection from before the roles were kept: every operator but the emergency account stays one after a
    disconnect, whatever made it one."""
    if not connected(db) or roles_kept(db):
        return []
    keeper = int(settings_service.get(db, "suite_emergency_account") or 0)
    return [row for row in db.scalars(select(Account).where(Account.role == OPERATOR).order_by(Account.name))
            if row.id != keeper]


def shown(row: Account) -> str:
    """How people see an account: its display name, else its name."""
    return row.display_name or row.name


def view(db: Session) -> dict[str, Any]:
    return {
        "state": state(db),
        "url": str(settings_service.get(db, "suite_url") or ""),
        "last_sync": settings_service.get(db, "suite_last_sync") or None,
        "problem": str(settings_service.get(db, "suite_problem") or ""),
        "emergency_codes": len(settings_service.get(db, "suite_emergency") or []),
        "mail": bool(settings_service.get(db, "suite_mail")),
    }


def refuse_if_managed(db: Session) -> None:
    """For the routes that change what nexsuite keeps (accounts, teams, rights, sign-in)."""
    if connected(db):
        from ..errors import error

        raise error("managed_by_suite", "This is kept in nexsuite now.", 409)


def refuse_unless_keeper(db: Session, account: Account, code: str = "disconnect_in_suite",
                         text: str = "Disconnect in nexsuite, or sign in with the emergency account.") -> None:
    """Disconnecting from the app's side is for the emergency account (its password is checked here). Whoever comes
    through nexsuite disconnects in nexsuite, where the own password is checked; here nobody would ask for it (A5).
    The same for carrying a backup away or deleting one: the archive holds the emergency account's password hash and
    second factor with the key to open it, a way to that account for whoever was never asked for a password."""
    if connected(db) and account.id != int(settings_service.get(db, "suite_emergency_account") or 0):
        from ..errors import error

        raise error(code, text, 403)


def dropped(db: Session, space: Space | None) -> bool:
    """A space nexsuite gave this app once and no longer does, while connected (B18)."""
    return space is not None and bool(space.external_id) and space.suite_dropped_at is not None and connected(db)


def refuse_if_space_managed(db: Session, space_id: int, account: Account | None = None) -> None:
    """The rights of a space nexsuite gives this app are kept there. With ``account``: a space it may not even read
    answers as if there were none (404), not "kept in nexsuite" (A14)."""
    from . import rights

    space = db.get(Space, space_id)
    if account is not None and space is not None and not rights.at_least(rights.role_in(db, account, space.id),
                                                                         rights.READ):
        from ..errors import error

        raise error("not_found", "Not found.", 404)
    if space is not None and space.external_id and connected(db):
        from ..errors import error

        raise error("managed_by_suite", "This is kept in nexsuite now.", 409)


# --- Talking to nexsuite ----------------------------------------------------------------------------------------------


def request(method: str, url: str, *, token: str = "", body: Any = None) -> Any:
    """One call to nexsuite's app API; replaced in the tests. Errors as ``SuiteError``."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            answer = client.request(method, url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise SuiteError("suite_unreachable", "nexsuite cannot be reached.") from exc
    if answer.status_code == 401:
        try:
            code = str(answer.json()["detail"]["code"])
        except (ValueError, KeyError, TypeError):
            code = ""
        if code == "app_unknown":
            raise SuiteError("suite_refused", "nexsuite does not know this app any more.", 409)
        # Some other 401 (a proxy asking for a sign-in, ...): not a reason to cut the connection for good (A13).
        raise SuiteError("suite_failed", "nexsuite refused.", 409)
    if answer.status_code >= 400:
        try:
            code = str(answer.json()["detail"]["code"])
        except (ValueError, KeyError, TypeError):
            code = "suite_failed"
        raise SuiteError(code, "nexsuite refused.", 409 if answer.status_code < 500 else 502, answer.status_code)
    if answer.status_code == 204 or not answer.content:
        return None
    try:
        return answer.json()
    except ValueError as exc:
        raise SuiteError("suite_failed", "nexsuite answered with something unreadable.") from exc


def picture(url: str, token: str) -> bytes:
    """A profile picture from nexsuite; replaced in the tests. Errors as ``SuiteError``."""
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            answer = client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise SuiteError("suite_unreachable", "nexsuite cannot be reached.") from exc
    if answer.status_code != 200:
        raise SuiteError("suite_failed", "nexsuite refused.", 409)
    return answer.content


def _take_picture(db: Session, row: Account, pid: str, stamp: Any, token: str) -> None:
    """The profile picture is kept in nexsuite: fetched once per change, gone when it is gone there."""
    from . import avatars

    if not stamp:
        if row.avatar is not None:
            row.avatar, row.avatar_at = None, None
        return
    wanted = _moment(stamp)
    if row.avatar is not None and row.avatar_at == wanted:
        return
    try:
        # Drawn anew like any upload: nothing of the file that came survives but its pixels.
        row.avatar = avatars.make(picture(_api(db, f"/avatars/{pid}"), token))
        row.avatar_at = wanted
    except (SuiteError, avatars.AvatarError) as exc:
        logger.info("Profile picture not taken name=%s (%s); tried again with the next sync", row.name,
                    getattr(exc, "code", type(exc).__name__))


def _api(db: Session, path: str) -> str:
    return str(settings_service.get(db, "suite_url")).rstrip("/") + "/api/connect/v1" + path


def clean_url(value: str) -> str:
    url = value.strip().rstrip("/")
    if not re.match(r"^https?://[^/\s?#@]+(/[^\s?#]*)?$", url):
        raise SuiteError("invalid_url", "Type the address of nexsuite, starting with http:// or https://.", 422)
    return url


# --- Connecting -------------------------------------------------------------------------------------------------------


@dataclass
class Proposal:
    people: list[dict[str, Any]]
    accounts: list[dict[str, Any]]
    spaces: list[dict[str, Any]]
    candidates: list[dict[str, Any]]
    #: The teams here and the teams in nexsuite to match them to (by name), so none is brought twice.
    teams: list[dict[str, Any]] = field(default_factory=list)
    team_candidates: list[dict[str, Any]] = field(default_factory=list)
    #: The choices kept from before the assistant was closed (``keep_choices``), or None.
    chosen: dict[str, Any] | None = None
    #: How many people, teams and spaces an earlier try made in nexsuite already: they stay there on giving up.
    made: int = 0
    #: A /finish went out whose answer did not come: its choices hold, others are refused (``connection_sent``).
    sent: bool = False


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


def start(db: Session, url: str, code: str, redirect_uri: str, own_url: str) -> Proposal:
    """Pairs with the code and fetches what to match. Nothing changes for the people here yet."""
    if connected(db):
        raise SuiteError("already_connected", "nexcanvas is already connected.", 409)
    if state(db) == "connecting":
        # A second pairing would leave the first, half app in nexsuite for good (B6): resume it or give it up.
        raise SuiteError("connecting_already", "A connection is under way: resume it or give it up.", 409)
    base = clean_url(url)
    if not 4 <= len(code.strip()) <= 40:
        # Too short or too long to be a code: said as a wrong code, not as a wrong address (B24); nexsuite is not asked.
        raise SuiteError("pair_code_invalid", "This code is not valid. Make a new one in nexsuite.", 409)
    try:
        made = request("POST", base + "/api/connect/v1/pair", body={
            "code": code.strip(), "url": own_url, "kind": KIND, "name": "nexcanvas", "version": __version__,
            "capabilities": CAPABILITIES, "redirect_uri": redirect_uri,
        })
    except SuiteError as exc:
        # Another app at that address (its own refusal would read like one of nexcanvas') or nexsuite under a path it
        # does not have: say that the address is wrong (B24).
        if exc.code in PAIR_CODES:
            raise
        if exc.http == 422:
            # nexsuite did not take the code as it came (too long, wrong characters): a wrong code too.
            raise SuiteError("pair_code_invalid", "This code is not valid. Make a new one in nexsuite.", 409) from exc
        raise _not_suite() from exc
    if not isinstance(made, dict) or not all(made.get(key) for key in ("token", "client_id", "client_secret",
                                                                         "issuer")):
        raise _not_suite()
    settings_service.save(db, {
        "suite_url": base,
        "suite_state": "connecting",
        "suite_token_enc": encrypt_secret(str(made["token"]), TOKEN_CONTEXT),
        "suite_pending": {"client_id": made["client_id"], "issuer": made["issuer"],
                          "secret_enc": encrypt_secret(str(made["client_secret"]), SECRET_CONTEXT)},
    })
    logger.info("Paired with nexsuite at %s", base)
    return proposal(db)


def _not_suite() -> SuiteError:
    return SuiteError("not_suite", "No nexsuite answers at this address. Use the address nexsuite opens at, without "
                                   "a path after it.", 409)


def proposal(db: Session) -> Proposal:
    if state(db) != "connecting":
        raise SuiteError("not_connecting", "Start with the address and the code.", 409)
    seen = request("GET", _api(db, "/directory"), token=_token(db))
    people = [p for p in seen["people"] if not p["blocked"]]
    by_mail = {_fold(p["email"]): p["id"] for p in people if p["email"]}
    by_name = {_fold(p["name"]): p["id"] for p in people}
    by_id = {str(p["id"]): p["id"] for p in people}
    everybody = {str(p["id"]) for p in seen["people"]}
    # The person an account had in this very nexsuite before a disconnect (B8 c): not one from another nexsuite,
    # whose ids mean other people.
    same_suite = str(settings_service.get(db, "suite_former_url") or "") == str(settings_service.get(db, "suite_url"))
    operator = operator_id(db)
    # Every suggestion at most once: a second account with the same address or name is suggested as new, never as
    # the same person (Prüfgang 04.10.2026, A7). The operator's own account goes first, then those nexsuite once
    # brought, so their own person is theirs and not taken by an account with a name alike.
    rows = sorted(db.scalars(select(Account)),
                  key=lambda row: (row.id != operator, not (same_suite and row.suite_person), row.id))
    taken: set[str] = set()
    accounts_out = []
    for row in rows:
        former = row.suite_person if same_suite else ""
        blocked = row.blocked_at is not None and row.id != operator
        guess = by_id.get(former) if former else None
        if guess is None and not blocked:
            guess = by_mail.get(_fold(row.email)) if row.email else None
            guess = guess or by_name.get(_fold(row.name))
        if guess in taken:
            guess = None
        if guess:
            taken.add(guess)
        # Blocked here (left out last time, blocked or deleted in nexsuite): it stays blocked unless the operator
        # chooses otherwise, never let in again by a suggestion (B8 a, b).
        suggest = guess or ("skip" if blocked else "new")
        accounts_out.append({"id": row.id, "name": row.name, "display_name": row.display_name, "email": row.email,
                             "role": row.role, "suggest": suggest, "blocked": blocked,
                             "from_suite": bool(former), "gone": bool(former) and former not in everybody})
    accounts_out.sort(key=lambda entry: entry["id"])
    candidates = list(seen.get("candidates") or [])
    spaces_out = _suggest([{"id": s.id, "name": s.name, "color": s.color, "alone": _alone(db, s.id)}
                           for s in db.scalars(select(Space).where(Space.deleted_at.is_(None)).order_by(Space.id))],
                          candidates)
    for entry in spaces_out:
        entry.pop("alone", None)
    team_candidates = [{"id": str(t["id"]), "name": t["name"], "color": t.get("color", "")}
                       for t in seen.get("teams") or []]
    teams_out = _suggest([{"id": t.id, "name": t.name, "color": t.color}
                          for t in db.scalars(select(Team).where(Team.source == TEAM_LOCAL).order_by(Team.id))],
                         team_candidates)
    pending = settings_service.get(db, "suite_pending") or {}
    chosen = pending.get("chosen") or None
    sent = pending.get("sent") or {}
    if "chosen" in sent:
        # /finish went out: the choices that went with it, as they were, with their targets by name (nexsuite offers
        # no space once it has the connection). Accounts, spaces and teams that came here since are not among them.
        picked, names = sent["chosen"], sent.get("names") or {}
        accounts_out = [entry for entry in accounts_out if str(entry["id"]) in picked["accounts"]]
        spaces_out = [entry for entry in spaces_out if str(entry["id"]) in picked["spaces"]]
        teams_out = [entry for entry in teams_out if str(entry["id"]) in picked["teams"]]
        listed = {str(person["id"]) for person in people}
        people = people + [person for person in names.get("people") or [] if person["id"] not in listed]
        candidates = list(names.get("spaces") or [])
        listed_teams = {team["id"] for team in team_candidates}
        team_candidates = team_candidates + [team for team in names.get("teams") or []
                                             if team["id"] not in listed_teams]
        chosen = {**picked, "step": 3}
    return Proposal(people=people, accounts=accounts_out, spaces=spaces_out, candidates=candidates, teams=teams_out,
                    team_candidates=team_candidates, chosen=chosen,
                    made=len(pending.get("made") or {}), sent=bool(pending.get("sent")))


def _as_sent(accounts_map: dict[int, str], spaces_map: dict[int, str], teams_map: dict[int, str]) -> dict[str, Any]:
    """The operator's choices as kept with a /finish that went out, to tell a later try with others."""
    return {"accounts": {str(k): v for k, v in accounts_map.items()},
            "spaces": {str(k): v for k, v in spaces_map.items()}, "teams": {str(k): v for k, v in teams_map.items()}}


def _sent_already() -> SuiteError:
    return SuiteError("connection_sent", "The connection was sent to nexsuite already; its choices apply. Cancel and "
                                         "connect again for other choices.", 409)


def keep_choices(db: Session, chosen: dict[str, Any]) -> None:
    """The operator's choices so far and the step, kept with the connection under way: closing the assistant or
    reloading the page resumes there instead of at the suggestions (B23). Checked and written under the lock a
    finish takes, so a late save never brings back what finishing cleared."""
    with _connect_lock:
        db.expire_all()
        if state(db) != "connecting":
            raise SuiteError("not_connecting", "Start with the address and the code.", 409)
        pending = dict(settings_service.get(db, "suite_pending") or {})
        if pending.get("sent"):
            # The choices of the /finish that went out hold; another one would only seem kept (review of e709c94).
            raise _sent_already()
        pending["chosen"] = chosen
        settings_service.save(db, {"suite_pending": pending})
        db.commit()


def _suggest(rows: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each row with the candidate of the same name as suggestion, every candidate at most once."""
    by_name = {_fold(c["name"]): str(c["id"]) for c in candidates}
    taken: set[str] = set()
    for row in rows:
        guess = by_name.get(_fold(row["name"]))
        if guess in taken:
            guess = None
        if guess:
            taken.add(guess)
        row["suggest"] = guess or row.get("alone") or "new"
    return rows


def _alone(db: Session, space_id: int) -> str:
    """A space of one person and no team (a personal one) is suggested to stay here, not to become shared (B7)."""
    members = db.scalar(select(func.count()).select_from(Membership).where(Membership.space_id == space_id)) or 0
    grants = db.scalar(select(func.count()).select_from(TeamGrant).where(TeamGrant.space_id == space_id)) or 0
    return "keep" if members == 1 and grants == 0 else ""


def operator_id(db: Session) -> int:
    """The account connecting (the first operator), whose suggestion comes first."""
    return int(db.scalar(select(Account.id).where(Account.role == OPERATOR).order_by(Account.id)) or 0)


def _no_twice(choices: dict[int, str], what: str) -> None:
    """A person, space or team in nexsuite gets at most one counterpart here (A7)."""
    chosen = [choice for choice in choices.values() if choice not in ("new", "skip", "keep")]
    twice = sorted({choice for choice in chosen if chosen.count(choice) > 1})
    if twice:
        raise SuiteError(f"{what}_twice", f"Each {what} in nexsuite can be chosen once only.", 422)


def finish(db: Session, operator: Account, accounts_map: dict[int, str], spaces_map: dict[int, str],
           teams_map: dict[int, str] | None = None) -> list[dict[str, str]]:
    """Applies the operator's choices: ``person id`` | ``new`` | ``skip`` per account, ``space id`` | ``new`` |
    ``keep`` (stays here, rights kept here) per space, ``team id`` | ``new`` per team. Then nexcanvas signs in
    through nexsuite and fetches the directory."""
    with _connect_lock:
        db.expire_all()
        return _finish(db, operator, accounts_map, spaces_map, teams_map)


def _known(choices: dict[Any, str], known: set[str], what: str, also: tuple[str, ...]) -> None:
    """Every choice names something nexsuite has (B9): an id it does not know would leave the account blocked and
    bring the person twice with the next connection."""
    for choice in choices.values():
        if choice not in also and str(choice) not in known:
            raise SuiteError(f"{what}_unknown", f"A {what} you chose is not in nexsuite (any more). Look at the "
                                                f"choices again.", 409)


def _finish(db: Session, operator: Account, accounts_map: dict[int, str], spaces_map: dict[int, str],
            teams_map: dict[int, str] | None) -> list[dict[str, str]]:
    if state(db) != "connecting":
        raise SuiteError("not_connecting", "Start with the address and the code.", 409)
    teams_map = teams_map or {}
    sent = (settings_service.get(db, "suite_pending") or {}).get("sent")
    if sent:
        # /finish went out before and its answer did not come, or writing it here failed: nexsuite may have the
        # connection already and refuse everything else. Only /finish again, with what was matched then. What came
        # with this request does not count: the choices are fixed since (keeping others is refused, the assistant
        # shows these locked), and accounts made or deleted meanwhile change nothing (decided 2026-10-07).
        return _confirm(db, _token(db), sent)
    _no_twice(accounts_map, "person")
    _no_twice(spaces_map, "space")
    _no_twice(teams_map, "team")
    token = _token(db)
    made_before = dict((settings_service.get(db, "suite_pending") or {}).get("made") or {})
    new_people: list[dict[str, str]] = []

    def remember(key: str, value: dict[str, str]) -> None:
        """What was made in nexsuite, kept at once: a retry after a failure uses it instead of making it again."""
        made_before[key] = value
        pending = dict(settings_service.get(db, "suite_pending") or {})
        pending["made"] = dict(made_before)
        settings_service.save(db, {"suite_pending": pending})
        db.commit()
    accounts_here = {row.id: row for row in db.scalars(select(Account))}
    seen = request("GET", _api(db, "/directory"), token=token)
    # Checked before anything is made in nexsuite or changed here.
    _known(accounts_map, {str(p["id"]) for p in seen["people"] if not p.get("blocked")}, "person", ("new", "skip"))
    _known(spaces_map, {str(c["id"]) for c in seen.get("candidates") or []}, "space", ("new", "keep"))
    _known(teams_map, {str(t["id"]) for t in seen.get("teams") or []}, "team", ("new",))
    addresses = {str(p["id"]): p.get("email") or "" for p in seen["people"]}
    shown_names = {str(p["id"]): p.get("display_name") or "" for p in seen["people"]}
    person_of: dict[int, str] = {}
    for account_id, choice in accounts_map.items():
        row = accounts_here.get(account_id)
        if row is None or choice == "skip":
            continue
        if choice == "new":
            made = made_before.get(f"person:{row.id}")
            if made is None:
                answer = request("POST", _api(db, "/people"), token=token,
                                 body={"name": row.name, "display_name": row.display_name, "email": row.email})
                made = {"id": str(answer["id"]), "password": str(answer.get("password") or "in_suite")}
                remember(f"person:{row.id}", made)
            new_people.append({"name": row.display_name or row.name, "password": made["password"]})
            choice = made["id"]
        else:
            if row.email and not addresses.get(str(choice)):
                # Matched to a person without an address: the one from here goes along instead of getting lost (B7).
                try:
                    request("POST", _api(db, f"/people/{int(choice)}/email"), token=token, body={"email": row.email})
                except SuiteError:
                    logger.info("nexsuite did not take the address name=%s", row.name)
            if row.display_name and not shown_names.get(str(choice)):
                # The same for the display name: the sync after connecting would otherwise take the person's empty
                # one, and the account would lose the name it had here (nexsuite 3ef5282). A refusal stops nothing.
                try:
                    request("POST", _api(db, f"/people/{int(choice)}/name"), token=token,
                            body={"display_name": row.display_name})
                except SuiteError:
                    logger.info("nexsuite did not take the display name name=%s", row.name)
        person_of[row.id] = str(choice)
    if operator.id not in person_of:
        raise SuiteError("operator_unmatched", "Your own account needs a person in nexsuite.", 422)
    team_of: dict[int, str] = {}
    for team in db.scalars(select(Team).where(Team.source == TEAM_LOCAL)):
        members = [person_of[m] for m in db.scalars(select(TeamMember.account_id).where(TeamMember.team_id == team.id))
                   if m in person_of]
        lead = person_of.get(team.lead_id) if team.lead_id else None
        choice = teams_map.get(team.id, "new")
        if choice == "new":
            made = made_before.get(f"team:{team.id}")
            if made is None:
                made = {"id": str(request("POST", _api(db, "/teams"), token=token, body={
                    "name": team.name, "color": team.color, "members": members, "lead": lead})["id"])}
                remember(f"team:{team.id}", made)
        else:
            # The same team in nexsuite: its members here come along, it is not made a second time (B2).
            made = request("POST", _api(db, f"/teams/{int(choice)}/join"), token=token,
                           body={"members": members, "lead": lead})
        team_of[team.id] = str(made["id"])
    # Nothing here changes before nexsuite has confirmed the connection (``/finish``): only what was made there is
    # kept on the way (``remember``). A failure at any step, the last one too, leaves the accounts, teams and spaces as
    # they were, and giving up leaves nothing half connected (review of ba44488).
    space_of: dict[int, str] = {}
    for space_id, choice in spaces_map.items():
        space = db.get(Space, space_id)
        if space is None or space.deleted_at is not None or choice == "keep":
            continue
        people = [{"id": person_of[m.account_id], "role": m.role}
                  for m in db.scalars(select(Membership).where(Membership.space_id == space.id))
                  if m.account_id in person_of]
        grants = db.scalars(select(TeamGrant).where(TeamGrant.space_id == space.id))
        teams = [{"id": team_of[g.team_id], "role": g.role} for g in grants if g.team_id in team_of]
        if choice == "new":
            made = made_before.get(f"space:{space.id}")
            if made is None:
                made = {"id": str(request("POST", _api(db, "/spaces"), token=token, body={
                    "name": space.name, "color": space.color, "people": people, "teams": teams})["id"])}
                remember(f"space:{space.id}", made)
            space_of[space.id] = made["id"]
        else:
            # Matched: the rights it has here come along, nexsuite keeps the higher where it has one (B1).
            request("POST", _api(db, f"/spaces/{int(choice)}/tick"), token=token,
                    body={"people": people, "teams": teams})
            space_of[space.id] = str(int(choice))
    # Kept before /finish goes out: nexsuite may take it and the answer never come back (a lost answer, or writing
    # here fails afterwards). The next try sends only /finish again and applies this (review of 4f54522).
    plan = {"operator": operator.id, "people": {str(k): v for k, v in person_of.items()},
            "teams": {str(k): v for k, v in team_of.items()}, "spaces": {str(k): v for k, v in space_of.items()},
            "skip": [k for k, v in accounts_map.items() if v == "skip"], "new_people": new_people,
            "chosen": _as_sent(accounts_map, spaces_map, teams_map),
            # The targets by name, for showing the choices after a reload: nexsuite offers no space once it has
            # the connection.
            "names": {
                "people": [{"id": str(p["id"]), "name": p.get("name") or "",
                            "display_name": p.get("display_name") or "", "email": p.get("email") or ""}
                           for p in seen["people"] if str(p["id"]) in set(accounts_map.values())],
                "spaces": [{"id": str(c["id"]), "name": c.get("name") or "", "color": c.get("color") or ""}
                           for c in seen.get("candidates") or [] if str(c["id"]) in set(spaces_map.values())],
                "teams": [{"id": str(t["id"]), "name": t.get("name") or "", "color": t.get("color") or ""}
                          for t in seen.get("teams") or [] if str(t["id"]) in set(teams_map.values())]}}
    pending = dict(settings_service.get(db, "suite_pending") or {})
    pending["sent"] = plan
    settings_service.save(db, {"suite_pending": pending})
    return _confirm(db, token, plan)


def _confirm(db: Session, token: str, plan: dict[str, Any]) -> list[dict[str, str]]:
    """Sends ``/finish`` and, once nexsuite has the connection, applies what was matched, here in one transaction with
    the settings (``settings_service.save`` commits). nexsuite's ``already_connected`` to it, asked with this app's own
    token, says it took an earlier ``/finish`` whose answer got lost: that is the confirmation too."""
    person_of = {int(k): str(v) for k, v in plan["people"].items()}
    team_of = {int(k): str(v) for k, v in plan["teams"].items()}
    space_of = {int(k): str(v) for k, v in plan["spaces"].items()}
    try:
        request("POST", _api(db, "/finish"), token=token, body={"people": len(person_of), "spaces": len(space_of)})
    except SuiteError as exc:
        if exc.code != "already_connected":
            raise
        logger.info("nexsuite has the connection already; it is finished here now")
    operator_id = int(plan["operator"])
    accounts_here = {row.id: row for row in db.scalars(select(Account))}
    chosen_accounts = (plan.get("chosen") or {}).get("accounts") or {}
    for space_id, external in space_of.items():
        space = db.get(Space, space_id)
        if space is not None:
            space.external_id = external
    for account_id, row in accounts_here.items():
        # Which accounts nexsuite knows from now on, by its person (B8, B21): the matched and the made ones. While
        # connected ``oidc_subject`` holds that person and nothing else: a link the account had to another provider
        # (authentik, Forgejo …) waits in ``oidc_subject_local`` until the disconnect, so a subject like "3" there
        # never passes for person 3 of nexsuite. One left out is nobody's there and is never renamed for it.
        person = person_of.get(account_id)
        if row.oidc_subject and row.oidc_subject != person:
            row.oidc_subject_local = row.oidc_subject
        row.oidc_subject = person or ""
        row.suite_person = person or ""
        # Left out, or made here after the choices (between pairing and finishing, or after /finish went out): no
        # person in nexsuite, so no way in while connected, and never a sign-in with a password of its own beside
        # nexsuite. Never the emergency account (review of 7afa9c1).
        if person is None and account_id != operator_id and row.blocked_at is None:
            row.blocked_at = utcnow()
            if str(account_id) not in chosen_accounts:
                logger.info("Account made after the choices blocked, no person in nexsuite name=%s", row.name)
    for team_id, external in team_of.items():
        team = db.get(Team, team_id)
        if team is not None:
            team.source, team.external_id = TEAM_ADMIN, external
    pending = settings_service.get(db, "suite_pending") or {}
    values = settings_service.get_all(db)
    # nexsuite becomes the provider: the coupled entry ``oidc`` of the list, the own entries set aside until the
    # disconnect (blueprint 06, ``nexoidc.coupling``). One transaction with everything above: the store only flushes.
    joined = _couple(db, pending)
    settings_service.save(db, {
        # What it was before, for the way back; the roles too, so that an operator role only nexsuite gave goes with
        # the connection (B17). An account made while connected was none before: a member. The settings of the one
        # provider from before the list (``OIDC_KEYS``) are only kept as they are, for one version.
        "suite_saved": {**{key: values[key] for key in (*OIDC_KEYS, *SMTP_KEYS, "password_login")},
                        "roles": {str(row.id): row.role for row in accounts_here.values()}},
        "suite_coupling": joined,
        "password_login": False,
        "suite_pending": None,
        "suite_state": "connected",
        "suite_emergency_account": operator_id,
    })
    logger.info("Connected to nexsuite: %s accounts, %s spaces", len(person_of), len(space_of))
    sync(db)
    return list(plan.get("new_people") or [])


def _store(db: Session) -> Any:
    from .oidc_store import SqlStore

    return SqlStore(db, hold=True)


def _couple(db: Session, pending: dict[str, Any]) -> dict[str, Any]:
    """The coupled entry with the accounts' persons as links, the own entries set aside; what is needed to put them
    back. A /finish that is applied again (its answer lost before, B23) finds the coupling made and keeps it."""
    store = _store(db)
    kept = settings_service.get(db, "suite_coupling")
    if providers.coupled(store) and isinstance(kept, dict):
        mirror_links(db)
        return kept
    joined = coupling.couple(
        store,
        issuer=str(pending.get("issuer", "")),
        client_id=str(pending.get("client_id", "")),
        client_secret=decrypt_secret(str(pending.get("secret_enc", "")), SECRET_CONTEXT),
        label=ENTRY_LABEL,
        people=[],
        # nexcanvas never asked a code after nexsuite: nexsuite checks the second factor (blueprint 06).
        trusts_second_factor=True,
    )
    mirror_links(db)
    return joined.as_dict()


def _coupled_entry(db: Session) -> OidcProvider | None:
    return db.scalar(select(OidcProvider).where(OidcProvider.managed == MANAGED_NEXSUITE).limit(1))


def mirror_links(db: Session) -> None:
    """The links of the coupled entry are the persons the accounts belong to (``oidc_subject`` while connected, as
    ``account_of_person`` finds them): who signs in through nexsuite as person "3" is the account nexsuite gave "3",
    never one whose own link elsewhere only looks the same (those wait with their own, set-aside entry). Called
    wherever the persons change: connecting, every sync. Flushes; the caller commits."""
    entry = _coupled_entry(db)
    if entry is None:
        return
    wanted: dict[str, int] = {}
    rows = sorted((row for row in db.scalars(select(Account).where(Account.oidc_subject != "")) if known(row)),
                  key=lambda row: (row.suite_person != row.oidc_subject, row.id))
    for row in rows:
        wanted.setdefault(row.oidc_subject, row.id)
    current = {link.subject: link for link in db.scalars(select(OidcLink).where(OidcLink.provider_id == entry.id))}
    for subject, link in current.items():
        if wanted.get(subject) != link.account_id:
            db.delete(link)
    db.flush()
    for subject, account_id in wanted.items():
        if subject in current and current[subject].account_id == account_id:
            continue
        db.add(OidcLink(provider_id=entry.id, subject=subject, account_id=account_id, issuer=entry.issuer))
    db.flush()


def _uncouple(db: Session) -> None:
    """The coupled entry goes with its links, the own entries come back as they were."""
    store = _store(db)
    kept = settings_service.get(db, "suite_coupling")
    if isinstance(kept, dict):
        coupling.uncouple(store, coupling.Coupling.from_dict(kept))
    entry = _coupled_entry(db)
    while entry is not None:
        # Kept nothing to put back (a coupling from before it was kept): the entry goes all the same.
        store.delete_provider(entry.id)
        entry = _coupled_entry(db)
    db.flush()


def abort(db: Session) -> bool:
    """Gives up a connection that did not finish; nexsuite is asked to forget the app. A finished connection is not
    given up this way: nexsuite would keep the app while it ran on its own, without anybody's password (B2). Under the
    lock a finish holds: a give-up from another tab waits for it and then finds the connection done. True when
    /finish had gone out and nexsuite could not be told: it may list the app as connected still."""
    with _connect_lock:
        db.expire_all()
        if state(db) == "connected":
            raise SuiteError("already_connected", "nexcanvas is already connected.", 409)
        kept = False
        if state(db) == "connecting":
            sent = bool((settings_service.get(db, "suite_pending") or {}).get("sent"))
            try:
                request("POST", _api(db, "/leave"), token=_token(db))
            except SuiteError:
                kept = sent
                if kept:
                    logger.warning("nexsuite not told of giving up a connection it may have; it may list the app")
        _forget(db)
        return kept


# --- Keeping in step --------------------------------------------------------------------------------------------------


def _open_mail(token: str, sealed: str) -> dict[str, Any]:
    raw = base64.urlsafe_b64decode(sealed)
    key = hashlib.sha256(b"nexsuite-seal:" + token.encode()).digest()
    return json.loads(AESGCM(key).decrypt(raw[:12], raw[12:], b"nexsuite-mail"))


def _claim_name(db: Session, wanted: str, present: set[str], keeper: int, renamed: list[tuple[str, str]]) -> str:
    """The name for an account nexsuite brings: the person's own. An account holding it whose person nexsuite knew
    (``suite_person``; never one left out when connecting, whatever link it has) and has deleted since (it stays
    here, blocked, with its boards) moves to the next free name, so a new person of that name is called as in nexsuite
    and not ``name2`` (B21). What still names it by its name follows in the same
    transaction (the notices it caused or concerned; the log after the commit, in ``renamed``), so nothing it did
    reads like the new person's. Never the emergency account: its name is its way in."""
    base = re.sub(r"[^a-z0-9._-]", "", wanted.lower())[:60] or "person"
    holder = db.scalar(select(Account).where(Account.name == base))
    if holder is not None and holder.id != keeper and holder.suite_person and holder.suite_person not in present:
        old = holder.name
        holder.name = _free_name(db, base + "2")
        db.execute(update(SpaceNotice).where(SpaceNotice.actor_id == holder.id).values(actor=holder.name))
        db.execute(update(SpaceNotice).where(SpaceNotice.subject == old).values(subject=holder.name))
        db.flush()
        renamed.append((old, holder.name))
    return _free_name(db, base)


def _free_name(db: Session, wanted: str, own_id: int | None = None) -> str:
    base = re.sub(r"[^a-z0-9._-]", "", wanted.lower())[:60] or "person"
    name, n = base, 2
    while True:
        holder = db.scalar(select(Account).where(Account.name == name))
        if holder is None or holder.id == own_id:
            return name
        name, n = f"{base}{n}", n + 1


def sync(db: Session) -> bool:
    """Fetches the directory and makes nexcanvas match it. False when nexsuite could not be asked."""
    if not connected(db):
        return False
    with _sync_lock:
        # A disconnect waits for a sync and the other way round; disconnected meanwhile, nothing is applied (B5).
        db.expire_all()
        if not connected(db):
            return False
        token = _token(db)
        try:
            seen = request("GET", _api(db, "/directory"), token=token)
        except SuiteError as exc:
            settings_service.save(db, {"suite_problem": exc.code})
            if exc.code == "suite_refused":
                logger.warning("nexsuite no longer knows this app; running on its own")
                disconnect(db, tell=False)
            return False
        _apply(db, seen, token)
        settings_service.save(db, {"suite_last_sync": utcnow().isoformat(), "suite_problem": "",
                                   "suite_revision": int(seen.get("revision") or 0)})
        return True


#: How long after a fetch for a person not known here another sign-in of that person fetches again (B20).
UNKNOWN_SECONDS = 10.0
_unknown_tried: dict[str, float] = {}
_unknown_lock = threading.Lock()


def sync_for_unknown(subject: str) -> None:
    """A person signs in through nexsuite but has no account here yet (made there a moment ago): the directory is
    fetched once now instead of turning the person away (B20). Once per person within ``UNKNOWN_SECONDS``, so sign-ins
    of somebody nexsuite does not give this app never become a stream of fetches. Blocking: run it off the event
    loop."""
    from ..db import SessionLocal

    now = time.monotonic()
    with _unknown_lock:
        for key in [k for k, at in _unknown_tried.items() if now - at > UNKNOWN_SECONDS]:
            del _unknown_tried[key]
        if subject in _unknown_tried:
            return
        _unknown_tried[subject] = now
    with SessionLocal() as db:
        sync(db)


def _moment(text: Any) -> datetime:
    """A time nexsuite sent; now when it cannot be read."""
    try:
        moment = datetime.fromisoformat(str(text))
    except ValueError:
        return utcnow()
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def known(row: Account) -> bool:
    """Whether nexsuite knows ``row`` by the person in its ``oidc_subject``. A connection made before ``suite_person``
    was kept counts an account not blocked (one left out is always blocked) until the next sync settles it."""
    return bool(row.oidc_subject) and (row.suite_person == row.oidc_subject
                                       or (not row.suite_person and row.blocked_at is None))


def account_of_person(db: Session, subject: str) -> Account | None:
    """While connected: the account of a person in nexsuite, never one whose own subject only looks the same."""
    rows = [row for row in db.scalars(select(Account).where(Account.oidc_subject == subject)) if known(row)]
    rows.sort(key=lambda row: row.suite_person != subject)
    return rows[0] if rows else None


def _alike(row: Account, person: dict[str, Any] | None) -> bool:
    """The account carries the person's own address and display name, as nexsuite gave them."""
    return person is not None and row.email == suite_email(person) \
        and row.display_name == shown_name(person.get("display_name"))


def _same_name(row: Account, person: dict[str, Any] | None) -> bool:
    """The account's sign-in name is the person's: the one thing an earlier sync never copied onto another account
    (address and display name it did, onto whichever account held the subject last)."""
    return person is not None and row.name.casefold() == str(person.get("name") or "").casefold()


def shown_name(value: object) -> str:
    """A display name from nexsuite, by the rule for names typed here: no control (Cc, C1 too) or format (Cf)
    characters, blanks gathered, at most 80 characters (A13)."""
    text = "".join(char for char in str(value or "") if unicodedata.category(char) not in ("Cc", "Cf"))
    return " ".join(text.split())[:80]


def plain_name(value: object, before: str = "") -> str:
    """A team or space name from nexsuite, by the rule for names typed here: no control character (Cc: C0, DEL and
    C1, which nexsuite takes), blanks gathered, at most 80 characters (A13). Nothing left: the name it had."""
    text = "".join(char for char in str(value or "") if unicodedata.category(char) != "Cc")
    return " ".join(text.split())[:80] or before or "?"


def suite_email(person: dict[str, Any] | None) -> str:
    """A person's address from nexsuite, only when it passes the check addresses typed here pass (no control
    character, one line); otherwise none."""
    email = str((person or {}).get("email") or "").strip()[:255]
    plain = not any(unicodedata.category(char) in ("Cc", "Cf") for char in email)
    return email if email and plain and accounts.EMAIL_PATTERN.match(email) else ""


def _switched(row: Account) -> bool:
    """An account with a password of its own that signs in through the provider: only a sync switches one so (the
    operator's "set a password" switches back, a provider makes accounts without one). Its subject is a person of
    nexsuite's, never a link of its own, also once nexsuite has deleted the person (review of ba44488)."""
    return row.sign_in == SIGN_IN_OIDC and bool(row.password_hash)


def _settle_subjects(db: Session, people: dict[str, dict[str, Any]], keeper: int, signed_out: list[int]) -> None:
    """Each subject is claimed by one account at most (connections made before ``oidc_subject_local`` existed, or a
    link made while connected).

    * An account whose ``suite_person`` names another person never claims one: the subject came while connected (a
      link), it is dropped, and the account goes back to its own person.
    * Among the rest, unmarked ones only when not blocked, carrying the person's sign-in name, or (person deleted
      there) switched to the provider by a sync, so a deleted person's id never turns into a link of its own on
      disconnecting; the first by: marked
      for this person (``suite_person``, what the operator chose when connecting), the sign-in name is the person's,
      not blocked, smallest id. The choice comes before the name: an account left out that kept a provider's subject
      of the same spelling never takes the person from the account it was given to. Address and display name do not
      count: an earlier sync copied them onto a stranger's account.
    * Every other one puts its subject apart (``oidc_subject_local``, its own link from before connecting); left
      without a person it is blocked like an account left out, and address and display name go when they are exactly
      those of the person whose subject it held (copied there). Better a second account for a person blocked there
      than a stranger's account handed to the person, unblocked."""
    rows = list(db.scalars(select(Account).where(Account.oidc_subject != "")))
    holders: dict[str, list[Account]] = {}
    for row in rows:
        holders.setdefault(row.oidc_subject, []).append(row)
    owner: dict[str, Account] = {}
    for subject, group in holders.items():
        person = people.get(subject)
        able = [row for row in group if row.suite_person == subject
                or (not row.suite_person and (row.blocked_at is None or _same_name(row, person)
                                              or (person is None and _switched(row))))]
        if able:
            owner[subject] = min(able, key=lambda row: (row.suite_person != subject, not _same_name(row, person),
                                                        row.blocked_at is not None, row.id))
    for row in rows:
        subject = row.oidc_subject
        if owner.get(subject) is row:
            row.suite_person = subject
            continue
        row.oidc_subject = ""
        own = row.suite_person if row.suite_person and row.suite_person != subject else ""
        if own:
            # A subject that came while connected (a link): nothing to keep for later.
            logger.info("A link made while connected dropped name=%s", row.name)
            if own not in owner and own not in holders:
                row.oidc_subject = own  # its own person in nexsuite, whose account it stays
                owner[own] = row
                continue
        else:
            logger.info("A link of its own kept apart from nexsuite name=%s", row.name)
            row.oidc_subject_local = subject
        row.suite_person = ""
        if _alike(row, people.get(subject)):
            # Copied there from the person by an earlier sync: not the account's own.
            row.email, row.display_name = "", ""
        if row.id != keeper and row.blocked_at is None:
            row.blocked_at = utcnow()
            signed_out.append(row.id)
    db.flush()


def _apply(db: Session, seen: dict[str, Any], token: str) -> None:
    keeper = int(settings_service.get(db, "suite_emergency_account") or 0)
    signed_out: list[int] = []
    # Settled, every subject left is a person nexsuite gave this account.
    _settle_subjects(db, {str(person["id"]): person for person in seen.get("people", [])}, keeper, signed_out)
    by_subject = {row.oidc_subject: row for row in db.scalars(select(Account).where(Account.oidc_subject != ""))}
    present = {str(person["id"]) for person in seen.get("people", [])}
    renamed: list[tuple[str, str]] = []
    account_of: dict[str, int] = {}
    for person in seen.get("people", []):
        pid = str(person["id"])
        row = by_subject.get(pid)
        if row is None:
            row = Account(name=_claim_name(db, str(person["name"]), present, keeper, renamed), sign_in=SIGN_IN_OIDC,
                          password_hash="", oidc_subject=pid, whats_new_seen=__version__)
            db.add(row)
            db.flush()
        row.display_name = shown_name(person.get("display_name"))
        row.email = suite_email(person)
        # nexsuite's address, not one a provider of its own gave (that one would go with the account's last link).
        row.email_source = ""
        if person.get("email") and not row.email:
            logger.warning("An address from nexsuite refused, the account keeps none name=%s", row.name)
        if row.id != keeper:
            # Signs in through nexsuite (password and second factor are set there); the own password stays kept
            # for a disconnect. Only the emergency account keeps signing in here.
            row.sign_in = SIGN_IN_OIDC
        # nexsuite knows this account by its person (also one connected before this was kept, B8, B21).
        row.suite_person = pid
        _take_picture(db, row, pid, person.get("avatar"), token)
        if person.get("signed_out"):
            # Signed out everywhere in nexsuite (or a new password there): the sessions here from before end too.
            ended = db.execute(delete(AuthSession).where(AuthSession.account_id == row.id,
                                                         AuthSession.created_at < _moment(person["signed_out"])))
            if ended.rowcount:
                logger.info("Sessions ended as in nexsuite name=%s count=%s", row.name, ended.rowcount)
            moment = str(person["signed_out"])[:64]
            if moment != row.suite_signed_out:
                # And the browsers known before: their device cookies no longer count, as after "sign out
                # everywhere" here. Once per new moment: a sync that brings the same one changes nothing (A5).
                row.suite_signed_out = moment
                row.device_key = new_device_key()
        if row.id != keeper:
            row.role = OPERATOR if person.get("operator") else MEMBER
        blocked = bool(person.get("blocked"))
        if blocked and row.blocked_at is None:
            row.blocked_at = utcnow()
            signed_out.append(row.id)
        elif not blocked and row.blocked_at is not None:
            row.blocked_at = None
        account_of[pid] = row.id
    # People nexsuite no longer has can no longer sign in here; the emergency account neither, as when blocked there
    # (Prüfgang D8, decided 04.10.2026). Disconnecting lets it in again.
    for subject, row in by_subject.items():
        if subject not in account_of and row.blocked_at is None:
            row.blocked_at = utcnow()
            signed_out.append(row.id)
    db.flush()
    team_of: dict[str, int] = {}
    existing = {t.external_id: t for t in db.scalars(select(Team).where(Team.source == TEAM_ADMIN))}
    for item in seen.get("teams", []):
        tid = str(item["id"])
        team = existing.pop(tid, None)
        if team is None:
            team = Team(name=plain_name(item["name"]), source=TEAM_ADMIN, external_id=tid)
            db.add(team)
            db.flush()
        team.name = plain_name(item["name"], team.name)
        team.color = str(item.get("color") or team.color)[:16]
        wanted = {account_of[m] for m in item.get("members", []) if m in account_of}
        current = set(db.scalars(select(TeamMember.account_id).where(TeamMember.team_id == team.id)))
        for member in wanted - current:
            db.add(TeamMember(team_id=team.id, account_id=member))
        for member in current - wanted:
            db.execute(delete(TeamMember).where(TeamMember.team_id == team.id, TeamMember.account_id == member))
        team.lead_id = account_of.get(str(item.get("lead"))) if item.get("lead") else None
        team_of[tid] = team.id
    for gone in existing.values():
        db.delete(gone)
    db.flush()
    spaces = {s.external_id: s for s in db.scalars(select(Space).where(Space.external_id != ""))}
    given: set[str] = set()
    for item in seen.get("spaces", []):
        sid = str(item["id"])
        given.add(sid)
        space = spaces.get(sid)
        if space is None:
            space = Space(name=plain_name(item["name"]), external_id=sid)
            db.add(space)
            db.flush()
        space.name = plain_name(item["name"], space.name)
        space.color = str(item.get("color") or space.color)[:16]
        if space.deleted_at is not None:
            space.deleted_at = None
        space.suite_dropped_at = None
        _set_grants(db, space.id,
                    {account_of[g["id"]]: g["role"] for g in item.get("people", []) if g["id"] in account_of},
                    {team_of[g["id"]]: g["role"] for g in item.get("teams", []) if g["id"] in team_of})
    # A space nexsuite no longer gives this app: its boards stay, only the operator sees them, marked "no longer in
    # nexsuite", and may put it into the trash here (B18). One in nexsuite's bin is still nexsuite's: it comes
    # back or goes for good from there, never by the clock or the bin here (E1, E3).
    binned = {str(item.get("id")) for item in seen.get("bin") or []}
    for sid, space in spaces.items():
        if sid in binned:
            space.suite_dropped_at = None
        if sid not in given:
            _set_grants(db, space.id, {}, {})
            if space.suite_dropped_at is None and sid not in binned:
                space.suite_dropped_at = utcnow()
                logger.info("Space no longer given by nexsuite id=%s", space.id)
    # Deleted in nexsuite: into this bin too, with nexsuite's date, so both empty after the same 30 days. A restore
    # there brings it back above (it is given again).
    for item in seen.get("bin") or []:
        space = spaces.get(str(item.get("id")))
        if space is not None and space.deleted_at is None:
            space.deleted_at = _moment(item.get("deleted_at"))
    # Deleted for good there: here too, with its boards (their files go with the next clean-up).
    for sid in seen.get("gone") or []:
        space = spaces.get(str(sid))
        if space is not None:
            logger.info("Space deleted for good in nexsuite, here too id=%s", space.id)
            db.delete(space)
    sealed = seen.get("mail")
    if sealed:
        mail = _open_mail(token, sealed)
        settings_service.save(db, {
            "smtp_host": str(mail["host"]), "smtp_port": int(mail["port"]), "smtp_security": str(mail["security"]),
            "smtp_user": str(mail["user"]), "smtp_from": str(mail["from"]),
            "smtp_password_enc": encrypt_secret(str(mail["password"])) if mail.get("password") else "",
            "suite_mail": True,
        })
    else:
        # nexsuite has no mail server: then neither has the app (the own one is kept for a disconnect). The mail
        # server is nexsuite's to set either way, never half here, half there.
        settings_service.save(db, {"smtp_host": "", "smtp_user": "", "smtp_password_enc": "", "smtp_from": "",
                                   "suite_mail": True})
    # Who signs in as which person: the links of the coupled entry follow the accounts' persons.
    mirror_links(db)
    settings_service.save(db, {"suite_emergency": list(seen.get("emergency") or [])})
    db.commit()
    for old, new in renamed:
        logs.rename_actor(old, new)
        # Written after the log followed the account, so this line keeps both names as they were meant.
        logger.info("Name %s given to a new person from nexsuite; the account of the deleted one is now %s", old, new)
    for account_id in signed_out:
        end_all_sessions(db, account_id)
    # Rights, teams and spaces may have changed with bulk statements the commit hook does not see.
    from . import live

    live.nudge()


def _set_grants(db: Session, space_id: int, people: dict[int, str], teams: dict[int, str]) -> None:
    people = {k: v for k, v in people.items() if v in SPACE_ROLES}
    teams = {k: v for k, v in teams.items() if v in SPACE_ROLES}
    current = {m.account_id: m for m in db.scalars(select(Membership).where(Membership.space_id == space_id))}
    for account_id, role in people.items():
        if account_id in current:
            current.pop(account_id).role = role
        else:
            db.add(Membership(space_id=space_id, account_id=account_id, role=role))
    for row in current.values():
        db.delete(row)
    grants = {g.team_id: g for g in db.scalars(select(TeamGrant).where(TeamGrant.space_id == space_id))}
    for team_id, role in teams.items():
        if team_id in grants:
            grants.pop(team_id).role = role
        else:
            db.add(TeamGrant(space_id=space_id, team_id=team_id, role=role))
    for row in grants.values():
        db.delete(row)


#: Signatures of the notices taken in the last ``NOTICE_SECONDS``, with the moment they run out: the same notice
#: twice is refused (A10).
_notices_seen: dict[str, float] = {}
_notices_lock = threading.Lock()


def check_notice(db: Session, stamp: str, signature: str, body: bytes) -> dict[str, Any] | None:
    """A notice from nexsuite, when it carries the right signature, is fresh (neither older nor further ahead than
    ``NOTICE_SECONDS``) and was not taken before; None otherwise."""
    if not connected(db) or not stamp.isascii() or not stamp.isdigit() or len(stamp) > 12:
        return None
    now = time.time()
    if abs(now - int(stamp)) > NOTICE_SECONDS:
        return None
    expected = hmac.new(_token(db).encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    # Compared as bytes: a signature with characters beyond ASCII is simply wrong, not a failure of the server (A10).
    if not hmac.compare_digest(expected.encode(), signature.encode("utf-8", "replace")):
        return None
    try:
        data = json.loads(body)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    with _notices_lock:
        for seen, until in list(_notices_seen.items()):
            if until < now:
                del _notices_seen[seen]
        if expected in _notices_seen:
            return None
        _notices_seen[expected] = int(stamp) + NOTICE_SECONDS
    return data


# --- The way back -----------------------------------------------------------------------------------------------------


def _forget(db: Session) -> None:
    settings_service.save(db, {"suite_state": "", "suite_url": "", "suite_token_enc": "", "suite_pending": None,
                               "suite_emergency": [], "suite_mail": False, "suite_problem": "",
                               "suite_last_sync": None})


def disconnect(db: Session, *, tell: bool = True) -> tuple[list[str], list[str], list[str]]:
    """Runs on its own again with everything it got. Returns the names of accounts without a password (they need
    one from the operator to sign in), of those blocked (in nexsuite, or left out): they stay blocked until the
    operator unblocks them here (B4), and of those whose operator role came from nexsuite only and is gone now (B17).
    Every way of disconnecting comes here: the operator's, the emergency code, and nexsuite's own notice. Never while
    a sync runs (B5)."""
    with _sync_lock:
        return _disconnect(db, tell=tell)


def _disconnect(db: Session, *, tell: bool) -> tuple[list[str], list[str], list[str]]:
    if tell and connected(db):
        try:
            request("POST", _api(db, "/leave"), token=_token(db))
        except SuiteError as exc:
            # nexsuite has forgotten the app already: nothing to tell. Out of reach: the plain way would leave it
            # holding an app that runs on its own, and make the emergency codes pointless (A11).
            if exc.code != "suite_refused":
                raise SuiteError("suite_unreachable_disconnect",
                                 "nexsuite does not answer. Disconnect with an emergency code, or try again when it is "
                                 "back.", 409) from exc
    saved = settings_service.get(db, "suite_saved") or {}
    # Before the sign-in goes back: an operator role only nexsuite gave ends with the connection (B17).
    back = []
    for row in operators_from_suite(db):
        row.role = MEMBER
        back.append(shown(row))
        logger.warning("Operator role from nexsuite ended name=%s", row.name)
    # The own sign-in providers come back as they were before connecting (``nexoidc.coupling``); the settings of the
    # one provider from before the list only as kept, for one version.
    _uncouple(db)
    restore = {key: saved[key] for key in (*OIDC_KEYS, "password_login") if key in saved}
    if not restore:
        restore = {"password_login": True}
    restore["suite_coupling"] = None
    if settings_service.get(db, "suite_mail"):
        restore.update({key: saved[key] for key in SMTP_KEYS if key in saved})
    settings_service.save(db, restore)
    for team in db.scalars(select(Team).where(Team.source == TEAM_ADMIN)):
        team.source, team.external_id = TEAM_LOCAL, ""
    for space in db.scalars(select(Space).where(Space.external_id != "")):
        space.external_id = ""
        space.suite_dropped_at = None
    keeper = db.get(Account, int(settings_service.get(db, "suite_emergency_account") or 0))
    if keeper is not None and keeper.blocked_at is not None:
        # Blocked because nexsuite blocked or deleted the person: with nexsuite gone, it is the way in again (D8).
        keeper.blocked_at = None
        logger.warning("Emergency account let in again on disconnecting name=%s", keeper.name)
        db.flush()
    without = []
    for row in db.scalars(select(Account).where(Account.oidc_subject != "")):
        # Only the accounts nexsuite knew sign in here again; one left out keeps its own link (authentik) as it was
        # and is no person of nexsuite's (B8). Connected before ``suite_person`` was kept: every account not blocked
        # was nexsuite's (one left out is always blocked).
        if not known(row):
            continue
        # Kept for connecting again to the same nexsuite (B8): the account is suggested its own person.
        row.suite_person = row.oidc_subject
        row.oidc_subject = ""
        if row.password_hash:
            row.sign_in = SIGN_IN_PASSWORD
        if not row.password_hash and row.blocked_at is None:
            without.append(row.name)
    for row in db.scalars(select(Account).where(Account.oidc_subject_local != "")):
        # The link of its own it had before connecting comes back with the provider it belongs to.
        if not row.oidc_subject:
            row.oidc_subject = row.oidc_subject_local
        row.oidc_subject_local = ""
    blocked = [row.name for row in
               db.scalars(select(Account).where(Account.blocked_at.is_not(None)).order_by(Account.name))]
    settings_service.save(db, {"suite_former_url": str(settings_service.get(db, "suite_url") or "")})
    db.commit()
    _forget(db)
    logger.warning("Disconnected from nexsuite; running on its own")
    return without, blocked, back


def emergency_ok(db: Session, code: str) -> bool:
    digest = hashlib.sha256(re.sub(r"[^A-Z0-9]", "", code.upper()).encode()).hexdigest()
    return any(hmac.compare_digest(digest, h) for h in settings_service.get(db, "suite_emergency") or [])


def report(db: Session, kind: str, who: str) -> None:
    """Tells nexsuite something for its log. Out of reach, the report waits and goes with a later round, with the
    address and key of the moment, also after an emergency disconnect (A11)."""
    owed = dict(settings_service.get(db, "suite_owed") or {})
    url = str(settings_service.get(db, "suite_url") or "")
    token = str(settings_service.get(db, "suite_token_enc") or "")
    if not url or not token:
        return
    if owed.get("url") != url or owed.get("token_enc") != token:
        owed = {"url": url, "token_enc": token, "reports": []}
    owed["reports"] = [*owed.get("reports", []), {"kind": kind, "who": who[:80]}][-OWED_MAX:]
    settings_service.save(db, {"suite_owed": owed})
    db.commit()
    deliver(db)


#: Reports kept for nexsuite while it is out of reach; the oldest go first when there are more.
OWED_MAX = 50


def deliver(db: Session) -> None:
    """Sends what nexsuite still has to hear (each round of the background loop, connected or not)."""
    owed = settings_service.get(db, "suite_owed") or {}
    reports = list(owed.get("reports") or [])
    if not reports:
        return
    token = decrypt_secret(str(owed["token_enc"]), TOKEN_CONTEXT)
    left: list[Any] = []
    for index, item in enumerate(reports):
        try:
            request("POST", str(owed["url"]).rstrip("/") + "/api/connect/v1/report", token=token, body=item)
        except SuiteError as exc:
            if exc.code == "suite_refused":
                break  # nexsuite has forgotten the app: nobody left to tell
            left = reports[index:]
            logger.info("nexsuite not told yet about %s (out of reach), tried again later", item.get("kind"))
            break
    settings_service.save(db, {"suite_owed": {**owed, "reports": left} if left else None})
    db.commit()


def run_forever_sync() -> None:
    """One round of the background loop (``main.py`` calls it once a minute)."""
    from ..db import SessionLocal

    with SessionLocal() as db:
        deliver(db)
        if connected(db):
            sync(db)

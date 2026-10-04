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
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, func, select
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
    Space,
    Team,
    TeamGrant,
    TeamMember,
    utcnow,
)
from ..security import decrypt_secret, encrypt_secret, end_all_sessions
from . import settings_service

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

_sync_lock = threading.RLock()
#: Set by the tests: a notice fetches the directory before it answers.
INLINE = False


class SuiteError(Exception):
    def __init__(self, code: str, text: str, status: int = 502) -> None:
        super().__init__(text)
        self.code, self.text, self.status = code, text, status


# --- State ------------------------------------------------------------------------------------------------------------


def state(db: Session) -> str:
    """``""`` (on its own), ``connecting`` or ``connected``."""
    return str(settings_service.get(db, "suite_state") or "")


def connected(db: Session) -> bool:
    return state(db) == "connected"


def _token(db: Session) -> str:
    stored = str(settings_service.get(db, "suite_token_enc") or "")
    return decrypt_secret(stored, TOKEN_CONTEXT) if stored else ""


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


def refuse_unless_keeper(db: Session, account: Account) -> None:
    """Disconnecting from the app's side is for the emergency account (its password is checked here). Whoever comes
    through nexsuite disconnects in nexsuite, where the own password is checked; here nobody would ask for it (A5)."""
    if connected(db) and account.id != int(settings_service.get(db, "suite_emergency_account") or 0):
        from ..errors import error

        raise error("disconnect_in_suite", "Disconnect in nexsuite, or sign in with the emergency account.", 403)


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
        raise SuiteError(code, "nexsuite refused.", 409 if answer.status_code < 500 else 502)
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
        logger.info("Profile picture of %s not taken (%s); tried again with the next sync", row.name,
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
    made = request("POST", base + "/api/connect/v1/pair", body={
        "code": code.strip(), "url": own_url, "kind": KIND, "name": "nexcanvas", "version": __version__,
        "capabilities": CAPABILITIES, "redirect_uri": redirect_uri,
    })
    settings_service.save(db, {
        "suite_url": base,
        "suite_state": "connecting",
        "suite_token_enc": encrypt_secret(str(made["token"]), TOKEN_CONTEXT),
        "suite_pending": {"client_id": made["client_id"], "issuer": made["issuer"],
                          "secret_enc": encrypt_secret(str(made["client_secret"]), SECRET_CONTEXT)},
    })
    logger.info("Paired with nexsuite at %s", base)
    return proposal(db)


def proposal(db: Session) -> Proposal:
    if state(db) != "connecting":
        raise SuiteError("not_connecting", "Start with the address and the code.", 409)
    seen = request("GET", _api(db, "/directory"), token=_token(db))
    people = [p for p in seen["people"] if not p["blocked"]]
    by_mail = {_fold(p["email"]): p["id"] for p in people if p["email"]}
    by_name = {_fold(p["name"]): p["id"] for p in people}
    # Every suggestion at most once: a second account with the same address or name is suggested as new, never as
    # the same person (Prüfgang 04.10.2026, A7). The operator's own account goes first.
    rows = sorted(db.scalars(select(Account)), key=lambda row: (row.id != operator_id(db), row.id))
    taken: set[str] = set()
    accounts_out = []
    for row in rows:
        guess = by_mail.get(_fold(row.email)) if row.email else None
        guess = guess or by_name.get(_fold(row.name))
        if guess in taken:
            guess = None
        if guess:
            taken.add(guess)
        accounts_out.append({"id": row.id, "name": row.name, "display_name": row.display_name, "email": row.email,
                             "role": row.role, "suggest": guess or "new"})
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
    return Proposal(people=people, accounts=accounts_out, spaces=spaces_out, candidates=candidates, teams=teams_out,
                    team_candidates=team_candidates)


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
    if state(db) != "connecting":
        raise SuiteError("not_connecting", "Start with the address and the code.", 409)
    teams_map = teams_map or {}
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
    addresses = {str(p["id"]): p.get("email") or "" for p in seen["people"]}
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
        elif row.email and not addresses.get(str(choice)):
            # Matched to a person without an address: the one from here goes along instead of getting lost (B7).
            try:
                request("POST", _api(db, f"/people/{int(choice)}/email"), token=token, body={"email": row.email})
            except SuiteError:
                logger.info("nexsuite did not take the address of %s", row.name)
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
    spaces_done = 0
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
            space.external_id = made["id"]
        else:
            # Matched: the rights it has here come along, nexsuite keeps the higher where it has one (B1).
            request("POST", _api(db, f"/spaces/{int(choice)}/tick"), token=token,
                    body={"people": people, "teams": teams})
            space.external_id = str(int(choice))
        spaces_done += 1
    for account_id, person in person_of.items():
        accounts_here[account_id].oidc_subject = person
    for account_id, choice in accounts_map.items():
        if choice == "skip" and account_id in accounts_here and account_id != operator.id:
            accounts_here[account_id].blocked_at = utcnow()
    for team_id, external in team_of.items():
        team = db.get(Team, team_id)
        if team is not None:
            team.source, team.external_id = TEAM_ADMIN, external
    db.commit()
    request("POST", _api(db, "/finish"), token=token, body={"people": len(person_of), "spaces": spaces_done})
    pending = settings_service.get(db, "suite_pending") or {}
    values = settings_service.get_all(db)
    settings_service.save(db, {
        # What it was before, for the way back.
        "suite_saved": {key: values[key] for key in (*OIDC_KEYS, *SMTP_KEYS, "password_login")},
        "oidc_issuer": str(pending.get("issuer", "")).rstrip("/"),
        "oidc_client_id": str(pending.get("client_id", "")),
        "oidc_client_secret_enc": encrypt_secret(decrypt_secret(str(pending.get("secret_enc", "")), SECRET_CONTEXT)),
        "oidc_provider_name": "nexsuite",
        "oidc_auto_create": False,
        "password_login": False,
        "suite_pending": None,
        "suite_state": "connected",
        "suite_emergency_account": operator.id,
    })
    logger.info("Connected to nexsuite: %s accounts, %s spaces", len(person_of), spaces_done)
    sync(db)
    return new_people


def abort(db: Session) -> None:
    """Gives up a connection that did not finish; nexsuite is asked to forget the app."""
    if state(db) == "connecting":
        try:
            request("POST", _api(db, "/leave"), token=_token(db))
        except SuiteError:
            pass
    _forget(db)


# --- Keeping in step --------------------------------------------------------------------------------------------------


def _open_mail(token: str, sealed: str) -> dict[str, Any]:
    raw = base64.urlsafe_b64decode(sealed)
    key = hashlib.sha256(b"nexsuite-seal:" + token.encode()).digest()
    return json.loads(AESGCM(key).decrypt(raw[:12], raw[12:], b"nexsuite-mail"))


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


def _moment(text: Any) -> datetime:
    """A time nexsuite sent; now when it cannot be read."""
    try:
        moment = datetime.fromisoformat(str(text))
    except ValueError:
        return utcnow()
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _apply(db: Session, seen: dict[str, Any], token: str) -> None:
    keeper = int(settings_service.get(db, "suite_emergency_account") or 0)
    by_subject = {row.oidc_subject: row for row in db.scalars(select(Account).where(Account.oidc_subject != ""))}
    account_of: dict[str, int] = {}
    signed_out: list[int] = []
    for person in seen.get("people", []):
        pid = str(person["id"])
        row = by_subject.get(pid)
        if row is None:
            row = Account(name=_free_name(db, str(person["name"])), sign_in=SIGN_IN_OIDC, password_hash="",
                          oidc_subject=pid, whats_new_seen=__version__)
            db.add(row)
            db.flush()
        row.display_name = str(person.get("display_name") or "")[:80]
        row.email = str(person.get("email") or "")[:255]
        if row.id != keeper:
            # Signs in through nexsuite (password and second factor are set there); the own password stays kept
            # for a disconnect. Only the emergency account keeps signing in here.
            row.sign_in = SIGN_IN_OIDC
        _take_picture(db, row, pid, person.get("avatar"), token)
        if person.get("signed_out"):
            # Signed out everywhere in nexsuite (or a new password there): the sessions here from before end too.
            ended = db.execute(delete(AuthSession).where(AuthSession.account_id == row.id,
                                                         AuthSession.created_at < _moment(person["signed_out"])))
            if ended.rowcount:
                logger.info("Sessions of %s ended as in nexsuite: %s", row.name, ended.rowcount)
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
            team = Team(name=str(item["name"])[:80], source=TEAM_ADMIN, external_id=tid)
            db.add(team)
            db.flush()
        team.name = str(item["name"])[:80]
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
            space = Space(name=str(item["name"])[:80], external_id=sid)
            db.add(space)
            db.flush()
        space.name = str(item["name"])[:80]
        space.color = str(item.get("color") or space.color)[:16]
        if space.deleted_at is not None:
            space.deleted_at = None
        _set_grants(db, space.id,
                    {account_of[g["id"]]: g["role"] for g in item.get("people", []) if g["id"] in account_of},
                    {team_of[g["id"]]: g["role"] for g in item.get("teams", []) if g["id"] in team_of})
    # A space nexsuite no longer gives this app: its boards stay, only the operator sees them.
    for sid, space in spaces.items():
        if sid not in given:
            _set_grants(db, space.id, {}, {})
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
    settings_service.save(db, {"suite_emergency": list(seen.get("emergency") or [])})
    db.commit()
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


def check_notice(db: Session, stamp: str, signature: str, body: bytes) -> dict[str, Any] | None:
    """A notice from nexsuite, when it carries the right signature and is fresh; None otherwise."""
    if not connected(db) or not stamp.isdigit() or abs(time.time() - int(stamp)) > NOTICE_SECONDS:
        return None
    expected = hmac.new(_token(db).encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        data = json.loads(body)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


# --- The way back -----------------------------------------------------------------------------------------------------


def _forget(db: Session) -> None:
    settings_service.save(db, {"suite_state": "", "suite_url": "", "suite_token_enc": "", "suite_pending": None,
                               "suite_emergency": [], "suite_mail": False, "suite_problem": "",
                               "suite_last_sync": None})


def disconnect(db: Session, *, tell: bool = True) -> tuple[list[str], list[str]]:
    """Runs on its own again with everything it got. Returns the names of accounts without a password (they need
    one from the operator to sign in) and of those blocked (in nexsuite, or left out): they stay blocked until the
    operator unblocks them here (B4). Never while a sync runs (B5)."""
    with _sync_lock:
        return _disconnect(db, tell=tell)


def _disconnect(db: Session, *, tell: bool) -> tuple[list[str], list[str]]:
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
    restore = {key: saved[key] for key in (*OIDC_KEYS, "password_login") if key in saved}
    if not restore:
        restore = {"oidc_issuer": "", "oidc_client_id": "", "oidc_client_secret_enc": "", "oidc_provider_name": "",
                   "oidc_auto_create": False, "password_login": True}
    if settings_service.get(db, "suite_mail"):
        restore.update({key: saved[key] for key in SMTP_KEYS if key in saved})
    settings_service.save(db, restore)
    for team in db.scalars(select(Team).where(Team.source == TEAM_ADMIN)):
        team.source, team.external_id = TEAM_LOCAL, ""
    for space in db.scalars(select(Space).where(Space.external_id != "")):
        space.external_id = ""
    keeper = db.get(Account, int(settings_service.get(db, "suite_emergency_account") or 0))
    if keeper is not None and keeper.blocked_at is not None:
        # Blocked because nexsuite blocked or deleted the person: with nexsuite gone, it is the way in again (D8).
        keeper.blocked_at = None
        logger.warning("Emergency account %s let in again on disconnecting", keeper.name)
        db.flush()
    without = []
    for row in db.scalars(select(Account).where(Account.oidc_subject != "")):
        row.oidc_subject = ""
        if row.password_hash:
            row.sign_in = SIGN_IN_PASSWORD
        if not row.password_hash and row.blocked_at is None:
            without.append(row.name)
    blocked = [row.name for row in
               db.scalars(select(Account).where(Account.blocked_at.is_not(None)).order_by(Account.name))]
    db.commit()
    _forget(db)
    logger.warning("Disconnected from nexsuite; running on its own")
    return without, blocked


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

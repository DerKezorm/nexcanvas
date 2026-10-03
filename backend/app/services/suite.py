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
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import __version__
from ..models import (
    MEMBER,
    OPERATOR,
    SIGN_IN_OIDC,
    SPACE_ROLES,
    TEAM_ADMIN,
    TEAM_LOCAL,
    Account,
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
CAPABILITIES = ["people", "teams", "spaces", "mail", "links"]
TIMEOUT = 10.0
#: A notice older than this is refused (against a notice caught and sent again later).
NOTICE_SECONDS = 300
TOKEN_CONTEXT = "suite-token"
SECRET_CONTEXT = "oidc-client-secret"
SMTP_KEYS = ("smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_password_enc", "smtp_from")
OIDC_KEYS = ("oidc_issuer", "oidc_client_id", "oidc_client_secret_enc", "oidc_provider_name", "oidc_auto_create")

_sync_lock = threading.Lock()
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


def refuse_if_space_managed(db: Session, space_id: int) -> None:
    """The rights of a space nexsuite gives this app are kept there."""
    space = db.get(Space, space_id)
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
        raise SuiteError("suite_refused", "nexsuite does not know this app any more.", 409)
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


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


def start(db: Session, url: str, code: str, redirect_uri: str, own_url: str) -> Proposal:
    """Pairs with the code and fetches what to match. Nothing changes for the people here yet."""
    if connected(db):
        raise SuiteError("already_connected", "nexcanvas is already connected.", 409)
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
    accounts_out = []
    for row in db.scalars(select(Account).order_by(Account.id)):
        guess = by_mail.get(_fold(row.email)) if row.email else None
        guess = guess or by_name.get(_fold(row.name))
        accounts_out.append({"id": row.id, "name": row.name, "display_name": row.display_name, "email": row.email,
                             "role": row.role, "suggest": guess or "new"})
    candidates = list(seen.get("candidates") or [])
    by_space = {_fold(c["name"]): c["id"] for c in candidates}
    spaces_out = [{"id": s.id, "name": s.name, "color": s.color, "suggest": by_space.get(_fold(s.name)) or "new"}
                  for s in db.scalars(select(Space).where(Space.deleted_at.is_(None)).order_by(Space.id))]
    return Proposal(people=people, accounts=accounts_out, spaces=spaces_out, candidates=candidates)


def finish(db: Session, operator: Account, accounts_map: dict[int, str], spaces_map: dict[int, str]) -> None:
    """Applies the operator's choices: ``person id`` | ``new`` | ``skip`` per account, ``space id`` | ``new`` per
    space. Then nexcanvas signs in through nexsuite and fetches the directory."""
    if state(db) != "connecting":
        raise SuiteError("not_connecting", "Start with the address and the code.", 409)
    token = _token(db)
    accounts_here = {row.id: row for row in db.scalars(select(Account))}
    person_of: dict[int, str] = {}
    for account_id, choice in accounts_map.items():
        row = accounts_here.get(account_id)
        if row is None or choice == "skip":
            continue
        if choice == "new":
            made = request("POST", _api(db, "/people"), token=token,
                           body={"name": row.name, "display_name": row.display_name, "email": row.email})
            choice = str(made["id"])
        person_of[row.id] = str(choice)
    if operator.id not in person_of:
        raise SuiteError("operator_unmatched", "Your own account needs a person in nexsuite.", 422)
    team_of: dict[int, str] = {}
    for team in db.scalars(select(Team).where(Team.source == TEAM_LOCAL)):
        members = [person_of[m] for m in db.scalars(select(TeamMember.account_id).where(TeamMember.team_id == team.id))
                   if m in person_of]
        made = request("POST", _api(db, "/teams"), token=token, body={
            "name": team.name, "color": team.color, "members": members,
            "lead": person_of.get(team.lead_id) if team.lead_id else None})
        team_of[team.id] = str(made["id"])
    spaces_done = 0
    for space_id, choice in spaces_map.items():
        space = db.get(Space, space_id)
        if space is None or space.deleted_at is not None:
            continue
        if choice == "new":
            people = [{"id": person_of[m.account_id], "role": m.role}
                      for m in db.scalars(select(Membership).where(Membership.space_id == space.id))
                      if m.account_id in person_of]
            grants = db.scalars(select(TeamGrant).where(TeamGrant.space_id == space.id))
            teams = [{"id": team_of[g.team_id], "role": g.role} for g in grants if g.team_id in team_of]
            made = request("POST", _api(db, "/spaces"), token=token,
                           body={"name": space.name, "color": None, "people": people, "teams": teams})
            space.external_id = str(made["id"])
        else:
            request("POST", _api(db, f"/spaces/{int(choice)}/tick"), token=token)
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
        _take_picture(db, row, pid, person.get("avatar"), token)
        if row.id != keeper:
            row.role = OPERATOR if person.get("operator") else MEMBER
        blocked = bool(person.get("blocked"))
        if blocked and row.blocked_at is None:
            row.blocked_at = utcnow()
            signed_out.append(row.id)
        elif not blocked and row.blocked_at is not None:
            row.blocked_at = None
        account_of[pid] = row.id
    # People nexsuite no longer has can no longer sign in here.
    for subject, row in by_subject.items():
        if subject not in account_of and row.blocked_at is None and row.id != keeper:
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


def disconnect(db: Session, *, tell: bool = True) -> list[str]:
    """Runs on its own again with everything it got. Returns the names of accounts without a password (they need
    one from the operator to sign in)."""
    if tell and connected(db):
        try:
            request("POST", _api(db, "/leave"), token=_token(db))
        except SuiteError:
            logger.info("nexsuite not told about the disconnect (unreachable)")
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
    without = []
    for row in db.scalars(select(Account).where(Account.oidc_subject != "")):
        row.oidc_subject = ""
        if not row.password_hash and row.blocked_at is None:
            without.append(row.name)
    db.commit()
    _forget(db)
    logger.warning("Disconnected from nexsuite; running on its own")
    return without


def emergency_ok(db: Session, code: str) -> bool:
    digest = hashlib.sha256(re.sub(r"[^A-Z0-9]", "", code.upper()).encode()).hexdigest()
    return any(hmac.compare_digest(digest, h) for h in settings_service.get(db, "suite_emergency") or [])


def report(db: Session, kind: str, who: str) -> None:
    """Tells nexsuite something for its log; quietly nothing when it cannot be reached."""
    try:
        request("POST", _api(db, "/report"), token=_token(db), body={"kind": kind, "who": who})
    except SuiteError:
        logger.info("nexsuite not told about %s (unreachable)", kind)


def run_forever_sync() -> None:
    """One round of the background loop (``main.py`` calls it once a minute)."""
    from ..db import SessionLocal

    with SessionLocal() as db:
        if connected(db):
            sync(db)

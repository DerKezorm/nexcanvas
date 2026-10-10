"""Setting up the first account, signing in and out, the own account, and the operator's list of accounts.

Invitations are in ``routers/members.py``, next to the rights they hand out.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import __version__
from ..config import get_settings
from ..deps import (
    Account,
    DbSession,
    OperatorAccount,
    behind_unknown_proxy,
    client_ip,
    confirm_operator,
    reauth_failed,
    reauth_guard,
    reauth_succeeded,
)
from ..errors import detail, error
from ..models import OPERATOR, ROLES, SIGN_IN_PASSWORD, Membership, utcnow
from ..models import Account as AccountRow
from ..security import (
    DEVICE_COOKIE,
    DEVICE_DAYS,
    MIN_PASSWORD,
    SESSION_COOKIE,
    Brake,
    brake,
    device_of,
    device_token,
    end_all_sessions,
    end_session,
    session_account,
    start_session,
)
from ..services import accounts, avatars, locales, mailer, settings_service, spaces, suite, totp
from ..services.accounts import AccountError
from ..services.oidc_store import SqlStore, linked_providers, offered_address
from ..vendor.nexoidc import providers

logger = logging.getLogger("nexcanvas.auth")

router = APIRouter(prefix="/api", tags=["auth"])

#: The languages inside the frontend; others come as files from the operator.
SHIPPED = ("en", "de")
#: Names a sign-in waiting for its second factor (``services/totp.py``), and nothing else.
PENDING_COOKIE = "nexcanvas_2fa" + get_settings().cookie_name_suffix()


class SetupIn(BaseModel):
    name: str = Field(max_length=64)
    password: str = Field(max_length=200)
    language: str = Field(default="", max_length=16)
    #: The setup code from the server's log (or NEXCANVAS_SETUP_TOKEN).
    code: str = Field(default="", max_length=200)


class LoginIn(BaseModel):
    name: str = Field(max_length=64)
    password: str = Field(max_length=200)


class PasswordChangeIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(max_length=200)


class LanguageIn(BaseModel):
    language: str = Field(max_length=16)


class ProfileIn(BaseModel):
    display_name: str = Field(max_length=200)


#: Longest display name, in characters.
DISPLAY_NAME_MAX = 80


def check_display_name(value: str) -> str:
    """Spaces gathered, no control or format characters, at most DISPLAY_NAME_MAX characters; empty shows the name.

    Control characters are Unicode Cc: C0, DEL and C1 (U+0080 to U+009F, which went through before, A13). Format
    characters (Cf: the right-to-left override, zero-width spaces) let a name read other than it is.
    """
    if any(unicodedata.category(char) in ("Cc", "Cf") for char in value):
        raise error("display_name_invalid", "A display name cannot hold control or invisible characters.", 422)
    clean = " ".join(value.split())
    if len(clean) > DISPLAY_NAME_MAX:
        raise error(
            "display_name_too_long", f"Use at most {DISPLAY_NAME_MAX} characters.", 422, maximum=DISPLAY_NAME_MAX
        )
    return clean


def secure_cookie(request: Request) -> bool:
    mode = get_settings().cookie_secure.lower()
    if mode == "on":
        return True
    if mode == "off":
        return False
    forwarded = request.headers.get("x-forwarded-proto", "")
    return request.url.scheme == "https" or forwarded.split(",")[0].strip() == "https"


def _set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=get_settings().session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=secure_cookie(request),
        path="/",
    )


def fail(exc: AccountError) -> HTTPException:
    return error(exc.code, exc.message, exc.status)


def check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise error("password_too_short", f"Use at least {MIN_PASSWORD} characters.", 422, minimum=MIN_PASSWORD)


def check_language(language: str) -> str:
    """Empty (the browser decides) or a language nexcanvas has."""
    if language and language not in SHIPPED and language not in {item.code for item in locales.available()}:
        raise error("unknown_language", "nexcanvas does not have this language.", 422)
    return language


def account_view(account: AccountRow, db: Session | None = None) -> dict[str, Any]:
    return {
        "id": account.id,
        "name": account.name,
        "display_name": account.display_name,
        # "What's new" (block X3): the running version and the one the account has read.
        "version": __version__,
        "whats_new_seen": account.whats_new_seen,
        "role": account.role,
        "sign_in": account.sign_in,
        "email": account.email,
        # The address a sign-in provider knows the account by, offered on the account page (blueprint 01).
        "provider_email": offered_address(db, account) if db is not None else "",
        "language": account.language,
        "two_factor": bool(account.totp_secret_enc),
        "two_factor_recovery_left": len(totp.load_recovery(account.totp_recovery)) if account.totp_secret_enc else 0,
        "created_at": account.created_at.isoformat(),
        "last_seen_at": account.last_seen_at.isoformat() if account.last_seen_at else None,
        "avatar": account.avatar_at.isoformat() if account.avatar_at else None,
    }


def known_device(db: DbSession, request: Request, response: Response, account: AccountRow) -> None:
    """Marks this browser as one the account signed in with (the device cookie)."""
    response.set_cookie(DEVICE_COOKIE, device_token(db, account), max_age=DEVICE_DAYS * 86400, httponly=True,
                        samesite="lax", secure=secure_cookie(request), path="/api/auth")


def sign_in(db: DbSession, request: Request, response: Response, account: AccountRow) -> dict[str, Any]:
    mailer.note_browser_language(account, request.headers.get("accept-language", ""))
    token = start_session(db, account, client_ip(request), request.headers.get("user-agent", ""))
    _set_cookie(response, request, token)
    # This browser is known from now on: a lock that strangers cause by guessing does not keep it out, and the brake
    # per sender lets it pass (A5).
    if device_of(db, request.cookies.get(DEVICE_COOKIE)) != account.id:
        known_device(db, request, response, account)
    logger.info("Signed in name=%s", account.name)
    return account_view(account)


@router.get("/setup", summary="Does nexcanvas still need its first account, and is this browser signed in?")
def setup_state(request: Request, db: DbSession) -> dict[str, Any]:
    # ``signed_in`` lets the page ask for the account only when there is one: a 401 would show as an error in the
    # browser's console on every visit of the sign-in page.
    return {
        "needs_setup": accounts.count(db) == 0,
        # The first account needs the setup code from the server's log.
        "code_required": True,
        "signed_in": session_account(db, request.cookies.get(SESSION_COOKIE)) is not None,
        "version": __version__,
        "min_password": MIN_PASSWORD,
    }


@router.post("/setup", summary="Create the operator account")
def setup(payload: SetupIn, request: Request, response: Response, db: DbSession) -> dict[str, Any]:
    key = "setup:" + client_ip(request)
    wait = brake.wait_seconds(key)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=detail("too_many_attempts", "Too many attempts. Try again later.", retry_after=wait),
            headers={"Retry-After": str(wait)},
        )
    check_password(payload.password)
    language = check_language(payload.language)
    try:
        account = accounts.create_operator(db, payload.name, payload.password, payload.code)
    except AccountError as exc:
        if exc.code == "setup_code_wrong":
            brake.failed(key)
            logger.warning("Setup refused: wrong setup code")
        raise fail(exc) from exc
    account.language = language
    db.commit()
    # A first space to start in, named in the language chosen here.
    spaces.create(db, account, "Persönlich" if language == "de" else "Personal")
    return sign_in(db, request, response, account)


@router.get("/auth/methods", summary="How one can sign in here (no sign-in needed)")
def methods(db: DbSession) -> dict[str, Any]:
    # The buttons of the sign-in page: slug and label of each active provider, nothing else (vendor/nexoidc).
    return {
        "password": bool(settings_service.get(db, "password_login")),
        "providers": providers.public_list(SqlStore(db)),
        # Connected to nexsuite: people sign in there; the password form is the operator's emergency way.
        "suite": suite.connected(db),
        # Where nexsuite opens, for "Sign in as someone else": signing out there first (B11). The button to sign in
        # leads there anyway, so the address tells nobody more than that.
        "suite_url": str(settings_service.get(db, "suite_url") or "") if suite.connected(db) else "",
    }


#: Wrong passwords one sender may give across all names before it waits: room for a household behind one address.
LOGIN_FREE_PER_SENDER = 30


@router.post("/auth/login", summary="Sign in with name and password")
def login(payload: LoginIn, request: Request, response: Response, db: DbSession) -> dict[str, Any]:
    # The brake first, then the password, then the rules: an unknown name costs the time of a wrong password, so
    # neither the answer nor its timing tells which names exist.
    #
    # Two counts: per sender and name, and per sender alone with more room. The second is not reset by a sign-in that
    # works (whoever has an account would otherwise reset it between guesses at other names). It always counts: an
    # X-Forwarded-For nexcanvas was not told to believe changes nothing about the sender (the connection counts), and
    # before, any such header took this count away (Prüfgang 05.10.2026 A5). Behind a proxy the operator did not
    # name, all senders share it; the log and Settings, Server say so and name the setting.
    #
    # So that a stranger behind such a proxy cannot keep everybody out, a browser that signed in as this very name
    # before (its device cookie, signed by the server) is counted on its own: not per sender, and per name only
    # together with the browser (``login-dev``), so that guesses at that very name from the same address do not hold
    # it either (decided 2026-10-05 and 2026-10-07, A5). Its own wrong passwords still slow it down. The emergency
    # account gets in that way while somebody guesses.
    ip = client_ip(request)
    behind_unknown_proxy(request)
    name = payload.name.strip().lower()[:64]
    cookie = request.cookies.get(DEVICE_COOKIE)
    device = device_of(db, cookie)
    known = accounts.by_name(db, payload.name) if device is not None else None
    if known is not None and known.id == device and cookie:
        keys = [("login-dev:" + cookie.split(".")[1] + "|" + name, Brake.FREE)]
    else:
        keys = [("login:" + ip + "|" + name, Brake.FREE), ("login-ip:" + ip, LOGIN_FREE_PER_SENDER)]
    wait = max(brake.wait_seconds(key, free) for key, free in keys)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=detail("too_many_attempts", "Too many attempts. Try again later.", retry_after=wait),
            headers={"Retry-After": str(wait)},
        )
    try:
        account = accounts.authenticate(db, payload.name, payload.password, device)
    except AccountError as exc:
        for key, _free in keys:
            brake.failed(key)
        raise fail(exc) from exc
    brake.succeeded(keys[0][0])
    if not settings_service.get(db, "password_login") and account.role != OPERATOR:
        # The operator keeps the password as the way in when the provider is down.
        raise error("password_login_off", "Sign-in with a password is turned off.", 403)
    if account.totp_secret_enc:
        # Nothing opens yet: the browser gets a short-lived cookie that names the waiting sign-in and nothing else.
        response.set_cookie(
            PENDING_COOKIE,
            totp.start_pending(account.id),
            max_age=totp.PENDING_SECONDS,
            httponly=True,
            samesite="lax",
            secure=secure_cookie(request),
            path="/api/auth",
        )
        logger.info("Password accepted, second factor waiting name=%s", account.name)
        return {"second_factor": True}
    tell_emergency(db, account)
    return sign_in(db, request, response, account)


def tell_emergency(db: DbSession, account: AccountRow) -> None:
    """Connected, a password sign-in is the emergency account's: nexsuite's log shows it, once the sign-in is complete
    (after the second factor, not after the password alone, A11)."""
    if not suite.connected(db):
        return
    import threading

    def _tell(name: str = account.name) -> None:
        from ..db import SessionLocal

        with SessionLocal() as own:
            suite.report(own, "emergency_sign_in", name)

    threading.Thread(target=_tell, name="suite-report", daemon=True).start()


@router.post("/auth/logout", status_code=204, summary="Sign out in this browser")
def logout(request: Request, response: Response, db: DbSession) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    account = session_account(db, token)
    end_session(db, token)
    if account is not None:
        logger.info("Signed out name=%s", account.name)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/auth/logout-all", status_code=204, summary="Sign out every other browser of the own account")
def logout_everywhere(request: Request, response: Response, account: Account, db: DbSession) -> None:
    end_all_sessions(db, account.id, except_token=request.cookies.get(SESSION_COOKIE))
    # The other browsers are not known any more; this one stays known.
    row = db.get(AccountRow, account.id)
    if row is not None:
        db.refresh(row)
        known_device(db, request, response, row)
    logger.info("All other sessions ended by their owner name=%s", account.name)


@router.get("/auth/me", summary="The signed-in account, and what this server offers it")
def me(account: Account, db: DbSession) -> dict[str, Any]:
    return {
        **account_view(account, db),
        "shares_allowed": bool(settings_service.get(db, "shares_allowed")),
        "mail": mailer.configured(db),
        "second_factor_setup_required": totp.setup_required(db, account),
        "upload_max_mb": settings_service.upload_max_mb(db),
        "preferences": preferences_of(account.preferences),
        "suite": suite.state(db),
        # Whether the lead of a team changes its members here: never while nexsuite keeps the teams, else the operator
        # always and a lead when the operator allows it (D3).
        "may_edit_led_teams": not suite.connected(db)
        and (account.role == OPERATOR or bool(settings_service.get(db, "team_leads_edit"))),
        "suite_mail": bool(settings_service.get(db, "suite_mail")),
        # Where nexsuite opens, for the links to where password, second factor and profile are changed (G3).
        "suite_url": str(settings_service.get(db, "suite_url") or "") if suite.connected(db) else "",
        # Connected: this account is the emergency account (its password and second factor are for that only).
        "suite_emergency": suite.connected(db)
        and account.id == int(settings_service.get(db, "suite_emergency_account") or 0),
    }


@router.put("/auth/password", status_code=204, summary="Change the own password")
def change_password(payload: PasswordChangeIn, request: Request, response: Response, account: Account,
                    db: DbSession) -> None:
    row = db.get(AccountRow, account.id)
    assert row is not None
    if row.sign_in != SIGN_IN_PASSWORD:
        raise error("oidc_account", "This account signs in through OIDC.", 409)
    check_password(payload.new)
    reauth_guard(request, row)
    try:
        accounts.change_password(db, row, payload.current, payload.new)
    except AccountError as exc:
        if exc.code == "wrong_password":
            reauth_failed(request, db, row)
        raise fail(exc) from exc
    reauth_succeeded(request, db, row)
    # Other browsers must sign in again and are not known any more; this one stays, and stays known.
    end_all_sessions(db, row.id, except_token=request.cookies.get(SESSION_COOKIE))
    db.refresh(row)
    known_device(db, request, response, row)


@router.put("/me/profile", summary="The own display name; empty shows the name")
def set_profile(payload: ProfileIn, account: Account, db: DbSession) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    row = db.get(AccountRow, account.id)
    assert row is not None
    shown = check_display_name(payload.display_name)
    if shown and _taken_by_another(db, row.id, shown):
        # Nobody shows up as somebody else: not under another account's name, nor its display name.
        raise error("display_name_taken", "Another account goes by this name.", 409)
    row.display_name = shown
    db.commit()
    return account_view(row)


def _taken_by_another(db: DbSession, own_id: int, shown: str) -> bool:
    folded = unicodedata.normalize("NFKC", shown).casefold()
    for other_id, name, display in db.execute(select(AccountRow.id, AccountRow.name, AccountRow.display_name)):
        if other_id == own_id:
            continue
        for taken in (name, display):
            if taken and unicodedata.normalize("NFKC", taken).casefold() == folded:
                return True
    return False


@router.post("/me/whats-new/seen", summary="\"What's new\" of the running version is read or put away")
def whats_new_seen(account: Account, db: DbSession) -> dict[str, Any]:
    row = db.get(AccountRow, account.id)
    assert row is not None
    row.whats_new_seen = __version__
    db.commit()
    return account_view(row)


@router.get("/people", summary="Display names for account names: of the own account and of those sharing a space")
def people(
    account: Account, db: DbSession, name: Annotated[list[str] | None, Query(max_length=64)] = None
) -> dict[str, str]:
    """Only names with a display name come back; one the caller may not see is left out like an unknown one, so
    nothing tells which names exist."""
    wanted = sorted({item.strip().lower() for item in (name or []) if item.strip()})[:200]
    if not wanted:
        return {}
    out: dict[str, str] = {}
    for row in db.scalars(select(AccountRow).where(AccountRow.name.in_(wanted), AccountRow.display_name != "")):
        if avatars.may_see(db, account, row.id):
            out[row.name] = row.display_name
    return out


@router.put("/me/language", summary="The language of the own account; empty follows the browser")
def set_language(payload: LanguageIn, account: Account, db: DbSession) -> dict[str, Any]:
    row = db.get(AccountRow, account.id)
    assert row is not None
    row.language = check_language(payload.language)
    db.commit()
    return account_view(row)


#: What an account may set for itself, with the values allowed; the first one is the default.
PREFERENCES: dict[str, tuple[Any, ...]] = {
    "snap": (True, False),
    "dots": (True, False),
    "tool_back": (True, False),
    "start": ("boards", "last"),
    #: The shape library on the left of a board: open or folded to a column of symbols.
    "library_open": (True, False),
}
#: Lists an account keeps: shapes it starred and the ones it took last, as ``package/shape``; the most of each.
PREFERENCE_LISTS: dict[str, int] = {"library_favorites": 200, "library_recent": 12}
SHAPE_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}/[a-z0-9][a-z0-9-]{0,39}$")
#: Packages an account switched off for its own library, by package id; the most it keeps.
HIDDEN_MOST = 200
PACKAGE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _shape_keys(value: Any, most: int, pattern: re.Pattern[str] = SHAPE_KEY) -> list[str] | None:
    if not isinstance(value, list) or len(value) > most:
        return None
    if not all(isinstance(v, str) and pattern.match(v) for v in value):
        return None
    return list(dict.fromkeys(value))


def preferences_of(stored: Any) -> dict[str, Any]:
    stored = stored if isinstance(stored, dict) else {}
    out = {key: stored[key] if stored.get(key) in allowed else allowed[0] for key, allowed in PREFERENCES.items()}
    for key, most in PREFERENCE_LISTS.items():
        out[key] = _shape_keys(stored.get(key), most) or []
    out["library_hidden"] = _shape_keys(stored.get("library_hidden"), HIDDEN_MOST, PACKAGE_ID) or []
    return out


@router.put("/me/preferences", summary="The own preferences; only the values sent change")
def set_preferences(payload: dict[str, Any], account: Account, db: DbSession) -> dict[str, Any]:
    row = db.get(AccountRow, account.id)
    assert row is not None
    current = preferences_of(row.preferences)
    for key, value in payload.items():
        if key in PREFERENCE_LISTS:
            keys = _shape_keys(value, PREFERENCE_LISTS[key])
            if keys is None:
                raise error("bad_preference", "This value is not one nexcanvas offers.", 422, field=key)
            current[key] = keys
            continue
        if key == "library_hidden":
            ids = _shape_keys(value, HIDDEN_MOST, PACKAGE_ID)
            if ids is None:
                raise error("bad_preference", "This value is not one nexcanvas offers.", 422, field=key)
            current[key] = ids
            continue
        allowed = PREFERENCES.get(key)
        if allowed is None or value not in allowed or type(value) is not type(allowed[0]):
            raise error("bad_preference", "This value is not one nexcanvas offers.", 422, field=key)
        current[key] = value
    row.preferences = current
    db.commit()
    return current


# --- Accounts (operator) --------------------------------------------------------------------------------------------


class RoleIn(BaseModel):
    role: str = Field(max_length=16)
    #: The operator's own password once more (see ``confirm_operator``); empty for an account from a provider.
    current_password: str = Field(default="", max_length=200)


class PasswordSetIn(BaseModel):
    password: str = Field(max_length=200)
    current_password: str = Field(default="", max_length=200)


class OperatorConfirmIn(BaseModel):
    current_password: str = Field(default="", max_length=200)


def _row(db: DbSession, account_id: int) -> AccountRow:
    row = db.get(AccountRow, account_id)
    if row is None:
        raise error("not_found", "No such account.", 404)
    return row


@router.get("/accounts", summary="All accounts")
def list_accounts(_operator: OperatorAccount, db: DbSession) -> list[dict[str, Any]]:
    spaces: dict[int, int] = {}
    for account_id in db.scalars(select(Membership.account_id)):
        spaces[account_id] = spaces.get(account_id, 0) + 1
    # The providers each account is linked to, as marks in the operator's list (the shared sign-in blueprint 04).
    linked = linked_providers(db)
    return [
        {**account_view(row), "spaces": spaces.get(row.id, 0), "locked": accounts.is_locked(row),
         "blocked": row.blocked_at is not None, "has_password": bool(row.password_hash),
         "providers": linked.get(row.id, [])}
        for row in db.scalars(select(AccountRow).order_by(AccountRow.created_at))
    ]


@router.delete("/accounts/{account_id}", status_code=204, summary="Delete an account")
def delete_account(
    account_id: int, payload: OperatorConfirmIn, request: Request, operator: OperatorAccount, db: DbSession,
) -> None:
    """Its rights go with it; its notes stay where they are. A space it was the only member of has no members any
    more and so belongs to the operator (who runs the disk it lies on anyway)."""
    suite.refuse_if_managed(db)
    confirm_operator(request, db, operator, payload.current_password)
    if account_id == operator.id:
        raise error("cannot_delete_self", "You cannot delete your own account.", 409)
    row = _row(db, account_id)
    name = row.name
    db.delete(row)
    db.commit()
    totp.forget_account(account_id)
    logger.warning("Account deleted name=%s by=%s", name, operator.name)


@router.post("/accounts/{account_id}/sign-out", status_code=204, summary="End every session of an account")
def sign_out_account(account_id: int, operator: OperatorAccount, db: DbSession) -> None:
    row = _row(db, account_id)
    end_all_sessions(db, row.id)
    logger.warning("All sessions ended name=%s by=%s", row.name, operator.name)


@router.post("/accounts/{account_id}/block", status_code=204, summary="Block an account (its sessions end)")
def block_account(
    account_id: int, payload: OperatorConfirmIn, request: Request, operator: OperatorAccount, db: DbSession,
) -> None:
    """On its own too, as in nexsuite (F5): blocked, the account gets in nowhere and its open boards close."""
    suite.refuse_if_managed(db)
    confirm_operator(request, db, operator, payload.current_password)
    if account_id == operator.id:
        raise error("cannot_block_self", "You cannot block yourself.", 409)
    row = _row(db, account_id)
    row.blocked_at = utcnow()
    db.commit()
    end_all_sessions(db, row.id)
    logger.warning("Account blocked name=%s by=%s", row.name, operator.name)


@router.post("/accounts/{account_id}/unblock", status_code=204, summary="Let a blocked account in again")
def unblock_account(
    account_id: int, payload: OperatorConfirmIn, request: Request, operator: OperatorAccount, db: DbSession,
) -> None:
    """Accounts blocked while nexcanvas hung on nexsuite (blocked or deleted there, or left out when connecting)
    stay blocked after a disconnect, until the operator lets them in here again (Prüfgang 04.10.2026, B4)."""
    suite.refuse_if_managed(db)
    confirm_operator(request, db, operator, payload.current_password)
    row = _row(db, account_id)
    row.blocked_at = None
    db.commit()
    logger.warning("Account unblocked name=%s by=%s", row.name, operator.name)


@router.put("/accounts/{account_id}/role", summary="Make an account operator or member")
def set_role(
    account_id: int, payload: RoleIn, request: Request, operator: OperatorAccount, db: DbSession,
) -> dict[str, Any]:
    suite.refuse_if_managed(db)
    confirm_operator(request, db, operator, payload.current_password)
    if payload.role not in ROLES:
        raise error("invalid_role", "Unknown role.", 422)
    row = _row(db, account_id)
    if row.id == operator.id and payload.role != OPERATOR:
        raise error("cannot_demote_self", "You cannot take the operator role from yourself.", 409)
    row.role = payload.role
    db.commit()
    logger.warning("Role changed name=%s role=%s by=%s", row.name, payload.role, operator.name)
    return account_view(row)


@router.put("/accounts/{account_id}/password", status_code=204, summary="Give an account a new password")
def set_password(
    account_id: int, payload: PasswordSetIn, request: Request, operator: OperatorAccount, db: DbSession,
) -> None:
    # Connected: passwords are nexsuite's; the emergency account sets its own under its account only (A5).
    suite.refuse_if_managed(db)
    confirm_operator(request, db, operator, payload.current_password)
    check_password(payload.password)
    row = _row(db, account_id)
    accounts.set_password(db, row, payload.password)
    end_all_sessions(db, row.id)
    logger.warning("Password set name=%s by=%s", row.name, operator.name)

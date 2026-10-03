"""Operator settings in the database, with defaults."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Setting

DEFAULTS: dict[str, Any] = {
    "log_mode": "normal",
    "log_mode_until": None,
    #: off | daily | weekly. Daily in the night unless the operator decides otherwise.
    "backup_schedule": "daily",
    "backup_keep": 7,
    #: Largest single photo or file on a board, in MB; never above ``NEXCANVAS_UPLOAD_MAX_MB``.
    "upload_max_mb": 50,
    #: Remove the place and the device from photos and videos on upload.
    "strip_location": True,
    #: The address people use to reach nexcanvas: invitation and share links, the OIDC redirect. Empty means
    #: ``NEXCANVAS_PUBLIC_URL``, and without that the request's own.
    "public_url": "",
    #: Members may sign in with a password. The operator always may: the emergency exit when OIDC fails.
    "password_login": True,
    #: Every account that signs in with a password needs a second factor; until it has one, it reaches only its
    #: account page. Accounts from OIDC bring their provider's.
    "two_factor_required": False,
    #: OIDC: issuer, client id and the encrypted client secret; empty means not set up.
    "oidc_issuer": "",
    "oidc_client_id": "",
    "oidc_client_secret_enc": "",
    "oidc_provider_name": "",
    #: Whether an unknown identity from the provider gets an account. Off: only invited or linked accounts.
    "oidc_auto_create": False,
    #: Public read-only pages of boards: a way out, closed until the operator opens it.
    "shares_allowed": False,
    #: Tokens for programs such as n8n or nexdeck (``/api/v1``): closed until the operator opens it.
    "api_tokens_allowed": False,
    #: Ask GitHub once a day whether a newer nexcanvas is out (services/updates). Only the question goes out, so on.
    "update_check": True,
    #: Invitation mail: without a host nothing is sent, the link to copy is enough.
    "smtp_host": "",
    "smtp_port": 587,
    #: starttls | tls | none
    "smtp_security": "starttls",
    "smtp_user": "",
    "smtp_password_enc": "",
    "smtp_from": "",
    #: nexsuite (``services/suite.py``): "" on its own, ``connecting``, ``connected``; its address, the app's token
    #: (sealed), what pairing gave until the operator finishes, what was set before (for the way back), the person
    #: whose own password sign-in stays (emergency account), the emergency code hashes, the last fetch.
    "suite_state": "",
    "suite_url": "",
    "suite_token_enc": "",
    "suite_pending": None,
    "suite_saved": None,
    "suite_emergency_account": 0,
    "suite_emergency": [],
    "suite_mail": False,
    "suite_last_sync": None,
    "suite_revision": 0,
    "suite_problem": "",
}


def get(db: Session, key: str) -> Any:
    row = db.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key)
    return row.value


def get_all(db: Session) -> dict[str, Any]:
    values = dict(DEFAULTS)
    for row in db.scalars(select(Setting)):
        values[row.key] = row.value
    return values


def save(db: Session, changes: dict[str, Any]) -> None:
    for key, value in changes.items():
        if key not in DEFAULTS:
            raise KeyError(key)
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value
    db.commit()


def normalize_public_url(value: str) -> str:
    """``scheme://host[:port]`` and nothing else, or empty. ``ValueError`` for anything people could not type into
    a browser: no other schemes, no credentials, no path, no query."""
    text = value.strip()
    if not text:
        return ""
    parts = urlsplit(text)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        raise ValueError("scheme or host")
    if parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise ValueError("path, query or credentials")
    try:
        parts.port  # noqa: B018 - raises ValueError when the port is not a number
    except ValueError as exc:
        raise ValueError("port") from exc
    return f"{parts.scheme.lower()}://{parts.netloc}"


def public_url(db: Session) -> str:
    """The public address without a trailing slash: the setting, otherwise the environment, otherwise empty."""
    stored = str(get(db, "public_url") or "").strip().rstrip("/")
    return stored or get_settings().public_url.strip().rstrip("/")


def upload_max_mb(db: Session) -> int:
    """The largest upload in MB: the operator's setting, never above what the environment allows."""
    return max(1, min(int(get(db, "upload_max_mb") or 1), get_settings().upload_max_mb))

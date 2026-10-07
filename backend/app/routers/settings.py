"""The operator's settings: address, sign-in, public pages, uploads, invitation mail, backups.

Secrets (the mail password) are written encrypted and never read back: the answer only says whether one is set.
The OIDC settings live in ``routers/oidc.py``.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..config import get_settings
from ..deps import DbSession, OperatorAccount, unknown_proxy_seen
from ..errors import error
from ..models import SIGN_IN_PASSWORD
from ..models import Account as AccountRow
from ..security import encrypt_secret
from ..services import accounts, mailer, settings_service, suite

logger = logging.getLogger("nexcanvas.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsOut(BaseModel):
    public_url: str
    password_login: bool
    two_factor_required: bool
    shares_allowed: bool
    backup_schedule: str
    backup_keep: int
    smtp_host: str
    smtp_port: int
    smtp_security: str
    smtp_user: str
    smtp_password_set: bool
    smtp_from: str
    api_tokens_allowed: bool
    team_leads_edit: bool
    upload_max_mb: int
    upload_ceiling_mb: int
    strip_location: bool
    update_check: bool
    #: Requests come with proxy headers, but no trusted proxy is configured (only in the answer of GET).
    proxy_unknown: bool = False


class SettingsIn(BaseModel):
    public_url: str | None = Field(default=None, max_length=255)
    password_login: bool | None = None
    two_factor_required: bool | None = None
    shares_allowed: bool | None = None
    backup_schedule: Literal["off", "daily", "weekly"] | None = None
    backup_keep: int | None = Field(default=None, ge=1, le=365)
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_security: Literal["starttls", "tls", "none"] | None = None
    smtp_user: str | None = Field(default=None, max_length=255)
    #: Empty removes the password; left out keeps it.
    smtp_password: str | None = Field(default=None, max_length=500)
    smtp_from: str | None = Field(default=None, max_length=255)
    api_tokens_allowed: bool | None = None
    team_leads_edit: bool | None = None
    upload_max_mb: int | None = Field(default=None, ge=1, le=100_000)
    strip_location: bool | None = None
    update_check: bool | None = None


class TestMailIn(BaseModel):
    to: str = Field(max_length=255)
    #: The language the operator's page shows, for the mail when neither the receiver nor the operator has one.
    language: str = Field(default="", max_length=16)


def _view(db: DbSession) -> SettingsOut:
    values = settings_service.get_all(db)
    return SettingsOut(
        public_url=values["public_url"],
        password_login=values["password_login"],
        two_factor_required=bool(values["two_factor_required"]),
        shares_allowed=values["shares_allowed"],
        backup_schedule=values["backup_schedule"],
        backup_keep=values["backup_keep"],
        smtp_host=values["smtp_host"],
        smtp_port=values["smtp_port"],
        smtp_security=values["smtp_security"],
        smtp_user=values["smtp_user"],
        smtp_password_set=bool(values["smtp_password_enc"]),
        smtp_from=values["smtp_from"],
        api_tokens_allowed=bool(values["api_tokens_allowed"]),
        team_leads_edit=bool(values["team_leads_edit"]),
        upload_max_mb=settings_service.upload_max_mb(db),
        upload_ceiling_mb=get_settings().upload_max_mb,
        strip_location=bool(values["strip_location"]),
        update_check=bool(values["update_check"]),
    )


@router.get("", response_model=SettingsOut)
def read(request: Request, _operator: OperatorAccount, db: DbSession) -> SettingsOut:
    # Requests come through a proxy nexcanvas was not told about: the sign-in brake sees one sender for everybody
    # (A5). The page names the setting.
    return _view(db).model_copy(update={"proxy_unknown": unknown_proxy_seen(request)})


@router.put("", response_model=SettingsOut)
def save(payload: SettingsIn, operator: OperatorAccount, db: DbSession) -> SettingsOut:
    changes: dict[str, Any] = {}
    sent = {key for key, value in payload.model_dump(exclude_unset=True).items() if value is not None}
    mail_managed = bool(settings_service.get(db, "suite_mail")) and any(k.startswith("smtp_") for k in sent)
    # The public address too: nexsuite knows the app by it, and the return address of the sign-in hangs on it (A9).
    # What team leads may as well: nexsuite keeps the teams and has its own switch for it (D3).
    kept_there = {"password_login", "two_factor_required", "public_url", "team_leads_edit"}
    if suite.connected(db) and (sent & kept_there or mail_managed):
        raise error("managed_by_suite", "This is kept in nexsuite now.", 409)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        if key == "public_url":
            try:
                value = settings_service.normalize_public_url(value)
            except ValueError as exc:
                raise error("invalid_url", "Enter an address starting with http:// or https://.", 422) from exc
        elif key == "smtp_from":
            value = value.strip()
            if value and not accounts.EMAIL_PATTERN.match(value):
                raise error("invalid_email", "This is not a mail address.", 422)
        elif key == "two_factor_required" and value and operator.sign_in == SIGN_IN_PASSWORD and not (
            operator.totp_secret_enc
        ):
            # Else the operator would be the first one sent to the account page, with nothing else in reach.
            raise error("own_second_factor_first", "Set up your own second factor first.", 409)
        elif key == "password_login" and not value:
            current = settings_service.get_all(db)
            if not (current["oidc_issuer"] and current["oidc_client_id"]):
                # Without a provider nobody but the operator could sign in any more, and invitations would fail.
                raise error("provider_first", "Set up a sign-in provider first.", 409)
        elif key == "upload_max_mb":
            value = min(int(value), get_settings().upload_max_mb)
        elif key == "smtp_password":
            changes["smtp_password_enc"] = encrypt_secret(value)
            continue
        elif isinstance(value, str):
            value = value.strip()
        changes[key] = value
    settings_service.save(db, changes)
    logger.info("Settings changed keys=%s by=%s", ",".join(sorted(changes)), operator.name)
    return _view(db)


@router.post("/mail-test", status_code=204, summary="Send a test mail through the configured server")
def mail_test(payload: TestMailIn, operator: OperatorAccount, db: DbSession) -> None:
    to = payload.to.strip()
    if not accounts.EMAIL_PATTERN.match(to):
        raise error("invalid_email", "This is not a mail address.", 422)
    # In the language of whoever receives it, as the invitation: an account with this address, else the operator's
    # own language, else the page's, else English (decision 8 of 05.10.2026).
    known = db.scalar(select(AccountRow).where(func.lower(AccountRow.email) == to.lower()).limit(1))
    language = mailer.language_for(db, known, *mailer.languages(operator, payload.language))
    try:
        mailer.send_test(db, to, language)
    except mailer.MailError as exc:
        # No mail server is a setting, not a failing server: no gateway error, no ERROR in the log (G12).
        raise error(exc.code, str(exc), 409 if exc.code == "mail_off" else 502) from exc

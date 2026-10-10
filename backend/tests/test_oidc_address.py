"""The public address and what hangs on it (module 1.0.10, README "Hinter einem Proxy"): the settings route asks before
it changes what authentik knows, the module's routes, the scheme a trusted proxy reports, the columns a raw insert
leaves out, and the hint on an API token that waits for a second factor.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.middleware import ForwardedProtoMiddleware
from app.models import Account, OidcProvider, utcnow
from app.routers.auth import secure_cookie
from app.services import settings_service
from app.vendor.nexoidc import MANAGED_AUTHENTIK, MANAGED_HAND

from . import oidc_helpers
from .conftest import PASSWORD, TAB, make_account, sign_in
from .oidc_helpers import FakeProvider, fresh_browser, location, sign_in_via_oidc
from .test_oidc_app import _required_with_linked_password_account

provider = oidc_helpers.provider

AUTHENTIK_OLD = "https://old.example.com"


def _entry(*, slug: str, managed: str, registered: str = "", enabled: bool = True) -> None:
    with SessionLocal() as db:
        db.add(OidcProvider(slug=slug, label=slug, issuer=f"https://{slug}.example.com", client_id=slug,
                            managed=managed, registered_redirect=registered, enabled=enabled))
        db.commit()


def _address() -> str:
    with SessionLocal() as db:
        return str(settings_service.get(db, "public_url") or "")


def _set_address(url: str) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"public_url": url})


# --- Card 1: the settings route asks before it changes what authentik knows ---------------------------------------------


def test_the_address_the_button_registered_is_asked_about_before_the_settings_change_it(
    client: TestClient, operator: Account
) -> None:
    _set_address(AUTHENTIK_OLD)
    _entry(slug="authentik", managed=MANAGED_AUTHENTIK, registered=AUTHENTIK_OLD + "/api/oidc/authentik/callback")
    asked = client.put("/api/settings", json={"public_url": "https://new.example.com"})
    assert asked.status_code == 409, asked.text
    detail = asked.json()["detail"]
    assert detail["code"] == "public_url_change" and detail["count"] == 1 and detail["hand"] == 0
    assert _address() == AUTHENTIK_OLD, "nothing is saved while the question stands"
    # The same address, answered: saved, and the button's entry reports that authentik knows an older one.
    saved = client.put("/api/settings", json={"public_url": "https://new.example.com", "confirm_address": True})
    assert saved.status_code == 200 and saved.json()["public_url"] == "https://new.example.com"
    assert _address() == "https://new.example.com"
    [listed] = [item for item in client.get("/api/oidc/admin/providers").json() if item["slug"] == "authentik"]
    assert listed["redirect_stale"] is True


def test_an_entry_by_hand_that_is_on_asks_too_and_one_that_is_off_does_not(
    client: TestClient, operator: Account
) -> None:
    _set_address(AUTHENTIK_OLD)
    _entry(slug="mine", managed=MANAGED_HAND, enabled=False)
    assert client.put("/api/settings", json={"public_url": "https://one.example.com"}).status_code == 200
    with SessionLocal() as db:
        db.execute(text("UPDATE oidc_providers SET enabled = 1"))
        db.commit()
    asked = client.put("/api/settings", json={"public_url": "https://two.example.com"})
    assert asked.status_code == 409 and asked.json()["detail"]["hand"] == 1 and asked.json()["detail"]["count"] == 0
    assert _address() == "https://one.example.com"


def test_other_settings_are_saved_without_a_question_and_the_same_address_is_none_either(
    client: TestClient, operator: Account
) -> None:
    _set_address(AUTHENTIK_OLD)
    _entry(slug="authentik", managed=MANAGED_AUTHENTIK, registered=AUTHENTIK_OLD + "/api/oidc/authentik/callback")
    assert client.put("/api/settings", json={"backup_keep": 5}).status_code == 200
    assert client.put("/api/settings", json={"public_url": AUTHENTIK_OLD}).status_code == 200


@pytest.mark.parametrize("address", [
    "https://" + "a" * 190 + ".example.com",  # longer than the module takes (199)
    "http://under_score.example.com",
    "https://exa mple.com",
    "ftp://example.com",
])
def test_the_settings_take_no_address_the_sign_in_module_refuses(
    client: TestClient, operator: Account, address: str
) -> None:
    refused = client.put("/api/settings", json={"public_url": address})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "invalid_url", refused.text
    assert _address() == ""


def test_the_modules_route_for_the_address_is_kept_in_nexsuite_while_coupled(
    client: TestClient, operator: Account
) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"suite_state": "connected"})
    refused = client.post("/api/oidc/authentik/address", json={"public_url": "https://new.example.com"})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "managed_by_suite"
    assert _address() == ""


def test_the_blueprint_names_no_address_it_guessed(client: TestClient, operator: Account) -> None:
    answer = client.get("/api/oidc/authentik/blueprint")
    assert answer.status_code == 409 and answer.json()["detail"]["code"] == "public_url_needed"
    _set_address("https://boards.example.com")
    assert client.get("/api/oidc/authentik/blueprint").status_code == 200


# --- Behind a proxy: the scheme is believed from a proxy nexcanvas trusts, from nobody else ---------------------------


def _operator_from(peer: str, operator: Account) -> TestClient:
    browser = TestClient(app, base_url="http://testserver", headers=TAB, client=(peer, 40000))
    sign_in(browser, operator)
    return browser


def _seen(browser: TestClient, **headers: str) -> dict[str, object]:
    answer = browser.get("/api/oidc/authentik/address", headers=headers)
    assert answer.status_code == 200, answer.text
    return dict(answer.json())


def test_a_trusted_proxy_says_the_request_came_over_https_and_the_app_believes_it(
    client: TestClient, operator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxies", "10.9.0.0/16")
    behind = _operator_from("10.9.0.5", operator)
    seen = _seen(behind, **{"X-Forwarded-Proto": "https"})
    assert str(seen["seen"]).startswith("https://") and seen["proxy_ignored"] is False
    # Of a list the rightmost counts: it is the one the proxy nearest to the app appended, while the first can be
    # sent by the visitor himself.
    assert str(_seen(behind, **{"X-Forwarded-Proto": "http, https"})["seen"]).startswith("https://")
    assert str(_seen(behind, **{"X-Forwarded-Proto": "https, http"})["seen"]).startswith("http://")
    # Case does not matter.
    assert str(_seen(behind, **{"X-Forwarded-Proto": "HTTPS"})["seen"]).startswith("https://")
    assert str(_seen(behind, **{"X-Forwarded-Proto": "http, HTTPS"})["seen"]).startswith("https://")
    # Not a scheme at all: the connection's own.
    assert str(_seen(behind, **{"X-Forwarded-Proto": "javascript"})["seen"]).startswith("http://")
    # Only the scheme: another host in the header changes nothing.
    assert str(_seen(behind, **{"X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.example"})["seen"]) == (
        "https://testserver")


def _scheme_of(scope: dict) -> str:
    """The scheme the app is given for ``scope`` after ``ForwardedProtoMiddleware`` (an ASGI call of its own)."""
    seen: dict = {}

    async def downstream(scope: dict, receive: object, send: object) -> None:
        seen.update(scope)

    asyncio.run(ForwardedProtoMiddleware(downstream)(scope, None, None))  # type: ignore[arg-type]
    return str(seen["scheme"])


def test_a_websocket_from_a_trusted_proxy_gets_ws_or_wss_by_the_same_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxies", "10.9.0.0/16")

    def scope(kind: str, value: bytes, peer: str = "10.9.0.5") -> dict:
        return {"type": kind, "scheme": "ws" if kind == "websocket" else "http", "client": (peer, 1),
                "headers": [(b"x-forwarded-proto", value)]}

    assert _scheme_of(scope("websocket", b"https")) == "wss"
    assert _scheme_of(scope("websocket", b"HTTPS")) == "wss"
    assert _scheme_of(scope("websocket", b"http, https")) == "wss"
    assert _scheme_of(scope("websocket", b"https, http")) == "ws"
    assert _scheme_of(scope("websocket", b"javascript")) == "ws", "not a scheme: the connection's own"
    assert _scheme_of(scope("websocket", b"https", peer="10.8.0.5")) == "ws", "no trusted proxy: believed by nobody"
    # The same header on a plain request, for the other side of the branch.
    assert _scheme_of(scope("http", b"http, https")) == "https"


def test_the_cookie_flag_follows_the_same_rule_of_the_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "cookie_secure", "auto")

    def secure(value: bytes) -> bool:
        scope = {"type": "http", "scheme": "http", "server": ("testserver", 80), "path": "/", "query_string": b"",
                 "headers": [(b"host", b"testserver"), (b"x-forwarded-proto", value)]}
        return secure_cookie(Request(scope))

    assert secure(b"http, https") and secure(b"HTTPS")
    assert not secure(b"https, http") and not secure(b"javascript")


def test_a_sender_that_is_no_trusted_proxy_cannot_make_the_app_see_another_scheme(
    client: TestClient, operator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxies", "10.9.0.0/16")
    stranger = _operator_from("10.8.0.5", operator)
    seen = _seen(stranger, **{"X-Forwarded-Proto": "https"})
    assert str(seen["seen"]).startswith("http://") and seen["proxy_ignored"] is True
    # And with no proxy named at all, nobody does.
    monkeypatch.setattr(get_settings(), "trusted_proxies", "")
    nobody = _operator_from("10.9.0.5", operator)
    assert str(_seen(nobody, **{"X-Forwarded-Proto": "https"})["seen"]).startswith("http://")


# --- Columns a raw insert leaves out ------------------------------------------------------------------------------------


def test_the_columns_added_for_the_way_back_and_the_second_factor_have_a_default_a_raw_insert_can_rely_on(
    client: TestClient, operator: Account
) -> None:
    """0.3.0 inserts into these tables without knowing these columns (the sign-in of the older version running on the
    migrated database): a column without a default made that insert fail."""
    with SessionLocal() as db:
        db.execute(text(
            "INSERT INTO auth_sessions (token_hash, account_id, created_at, expires_at, last_seen_at, ip, user_agent)"
            " VALUES ('raw-0-3', :account, :now, :later, :now, '', '')"
        ), {"account": operator.id, "now": utcnow(), "later": utcnow() + timedelta(days=1)})
        db.execute(text(
            "INSERT INTO oidc_providers (slug, label, issuer, client_id, client_secret_enc, scopes, enabled,"
            " auto_create, trusts_second_factor, managed, position, redirect_path, created_at)"
            " VALUES ('raw', 'Raw', 'https://raw.example.com', 'raw', '', 'openid', 1, 0, 1, '', 5, '', :now)"
        ), {"now": utcnow()})
        db.commit()
        assert db.execute(text("SELECT provider_checked FROM auth_sessions WHERE token_hash = 'raw-0-3'")).scalar() == 0
        assert db.execute(text("SELECT registered_redirect FROM oidc_providers WHERE slug = 'raw'")).scalar() == ""


#: What 0.3.0 writes into ``accounts`` (every NOT NULL column of its model); it does not know the three of the sign-in
#: provider list.
ACCOUNT_COLUMNS_OF_0_3 = (
    "name", "display_name", "whats_new_seen", "role", "sign_in", "password_hash", "email", "oidc_subject",
    "language", "suite_person", "oidc_subject_local", "browser_language", "created_at", "failed_logins",
    "totp_secret_enc", "totp_recovery", "totp_last_step", "device_key", "suite_signed_out",
)


def test_an_account_inserted_by_0_3_without_the_columns_of_the_provider_list_is_made(
    client: TestClient, operator: Account
) -> None:
    """A database made by this version (``create_all``), written by 0.3.0: its insert of an account names no
    ``email_source``, ``provider_email`` or ``provider_email_off`` and must not fail on a NOT NULL."""
    with SessionLocal() as db:
        have = {row[1] for row in db.execute(text("PRAGMA table_info(accounts)"))}
        assert set(ACCOUNT_COLUMNS_OF_0_3) <= have
        values = {column: 0 if column in ("failed_logins", "totp_last_step") else "" for column in ACCOUNT_COLUMNS_OF_0_3}
        values.update(name="raw-0-3", created_at=utcnow(), role="member", sign_in="password")
        names, marks = ", ".join(values), ", ".join(":" + column for column in values)
        db.execute(text(f"INSERT INTO accounts ({names}) VALUES ({marks})"), values)  # noqa: S608 - constant names
        db.commit()
        row = db.execute(text(
            "SELECT email_source, provider_email, provider_email_off FROM accounts WHERE name = 'raw-0-3'"
        )).one()
        assert tuple(row) == ("", "", "")


# --- A token waits for a second factor the account has not set up -----------------------------------------------------


def _tokens_on() -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"api_tokens_allowed": True})


def test_a_password_account_in_a_session_a_provider_sheltered_sees_that_its_token_works_only_with_a_second_factor(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _required_with_linked_password_account(client, provider, trusts=True)
    _tokens_on()
    sheltered = fresh_browser()
    assert location(sign_in_via_oidc(sheltered, provider, sub="anna-1", preferred_username="anna")) == "/"
    assert sheltered.get("/api/api-tokens").json()["second_factor_pending"] is True
    made = sheltered.post("/api/api-tokens", json={"name": "n8n"})
    assert made.status_code == 201, "making one stays possible"
    assert made.json()["second_factor_pending"] is True
    # And it does wait: the program is told no.
    secret = made.json()["secret"]
    assert fresh_browser().get("/api/v1/me", headers={"Authorization": f"Bearer {secret}"}).status_code == 401


def test_no_hint_where_a_token_works(client: TestClient, operator: Account, provider: FakeProvider) -> None:
    _tokens_on()
    # The operator requires nothing: the token works.
    assert client.get("/api/api-tokens").json()["second_factor_pending"] is False
    # Required, and the account has set one up.
    with SessionLocal() as db:
        from app.services import totp

        settings_service.save(db, {"two_factor_required": True})
        row = db.scalar(select(Account).where(Account.id == operator.id))
        assert row is not None
        row.totp_secret_enc = totp.seal_seed(totp.generate_seed())
        db.commit()
    assert client.get("/api/api-tokens").json()["second_factor_pending"] is False


def test_an_account_from_a_provider_has_no_hint_its_providers_check_is_its_second_factor(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _tokens_on()
    with SessionLocal() as db:
        settings_service.save(db, {"two_factor_required": True})
    made = make_account("carl", password=PASSWORD)
    with SessionLocal() as db:
        row = db.get(Account, made.id)
        assert row is not None
        row.sign_in, row.password_hash = "oidc", ""
        db.commit()
    browser = fresh_browser()
    sign_in(browser, made)
    assert browser.get("/api/api-tokens").json()["second_factor_pending"] is False

"""nexcanvas' own side of sign-in through providers, around the shared contract tests (``tests/nexoidc``): the
migration from the single provider of 0.3 (on its own and while coupled to nexsuite), the address a provider gives,
the operator's account list and unlinking, the password switch, the attempt cookie of two instances on one host, and
the log.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import SIGN_IN_OIDC, Account, OidcLink, OidcProvider, SpaceNotice
from app.security import encrypt_secret
from app.services import backups, oidc_store, settings_service, suite

from . import oidc_helpers
from .conftest import PASSWORD, make_account, sign_in
from .oidc_helpers import (
    FakeProvider,
    add_provider,
    configure,
    error_in,
    fresh_browser,
    link,
    location,
    sign_in_via_oidc,
)

provider = oidc_helpers.provider

#: The issuer as nexcanvas 0.3's authentik button stored it: with the slash authentik writes.
AUTHENTIK_ISSUER = "https://sso.example.com/application/o/nexcanvas/"


def _legacy(fake: FakeProvider, *, label: str, issuer: str | None = None, auto_create: bool = False,
            subjects: dict[str, str] | None = None) -> None:
    """nexcanvas 0.3.0 as it kept its one provider: in the settings (the secret without a context), the subject at
    the account."""
    with SessionLocal() as db:
        settings_service.save(db, {
            "oidc_issuer": issuer or fake.issuer,
            "oidc_client_id": fake.client_id,
            "oidc_client_secret_enc": encrypt_secret(fake.client_secret),
            "oidc_provider_name": label,
            "oidc_auto_create": auto_create,
            oidc_store.MIGRATED: False,
        })
        for name, subject in (subjects or {}).items():
            row = db.scalar(select(Account).where(Account.name == name))
            assert row is not None
            row.oidc_subject = subject
        db.commit()


def _entries() -> list[OidcProvider]:
    with SessionLocal() as db:
        rows = list(db.scalars(select(OidcProvider).order_by(OidcProvider.id)))
        for row in rows:
            db.expunge(row)
        return rows


def _links(provider_id: int) -> list[tuple[str, str]]:
    with SessionLocal() as db:
        return sorted((link.subject, db.get(Account, link.account_id).name)  # type: ignore[union-attr]
                      for link in db.scalars(select(OidcLink).where(OidcLink.provider_id == provider_id)))


def _row(name: str) -> Account:
    with SessionLocal() as db:
        row = db.scalar(select(Account).where(Account.name == name))
        assert row is not None
        db.expunge(row)
        return row


# --- The migration ----------------------------------------------------------------------------------------------------


def test_the_migration_makes_a_backup_first_and_keeps_name_auto_create_and_every_link(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    make_account("anna")
    make_account("ben")
    _legacy(provider, label="Company", auto_create=True, subjects={"anna": "anna-1", "ben": "ben-1"})
    before = len(backups.entries())
    entry = oidc_store.migrate_settings()
    assert entry is not None and len(backups.entries()) == before + 1
    assert backups.entries()[0].kind == backups.UPDATE
    [row] = _entries()
    assert (row.slug, row.label, row.auto_create, row.trusts_second_factor, row.managed, row.enabled) == (
        "oidc", "Company", True, True, "", True)
    assert _links(row.id) == [("anna-1", "anna"), ("ben-1", "ben")]
    with SessionLocal() as db:
        assert oidc_store.SqlStore(db).provider_by_slug("oidc").client_secret == provider.client_secret  # type: ignore[union-attr]
    # A second start does nothing, and makes no second backup.
    assert oidc_store.migrate_settings() is None and len(backups.entries()) == before + 1
    # The old address still signs anna in.
    provider.person = {"sub": "anna-1", "preferred_username": "anna"}
    browser = fresh_browser()
    target = location(browser.get("/api/oidc/oidc/start"))
    assert "%2Fapi%2Foidc%2Fcallback" in target
    assert location(browser.get("/api/oidc/callback", params=provider.authorize(target))) == "/"
    assert browser.get("/api/auth/me").json()["name"] == "anna"


def test_removing_every_entry_after_the_migration_brings_the_old_provider_back_never(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _legacy(provider, label="Company")
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
    assert oidc_store.migrate_settings(backup=False) is None and _entries() == []
    # Even with settings of 0.3 written again behind its back (a backup of 0.3 put in by hand): moved once is moved.
    with SessionLocal() as db:
        settings_service.save(db, {"oidc_issuer": provider.issuer, "oidc_client_id": provider.client_id})
    assert oidc_store.migrate_settings(backup=False) is None and _entries() == []


def test_the_button_of_0_3_becomes_an_entry_the_button_looks_after_without_the_slash(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _legacy(provider, label="authentik", issuer=AUTHENTIK_ISSUER)
    oidc_store.migrate_settings(backup=False)
    [row] = _entries()
    assert (row.slug, row.managed, row.issuer, row.redirect_path) == (
        "oidc", "authentik", AUTHENTIK_ISSUER.rstrip("/"), "")
    assert client.get("/api/oidc/admin/providers").json()[0]["redirect_uri"] == "http://testserver/api/oidc/callback"
    # The same name typed by hand with another issuer is the operator's own.
    with SessionLocal() as db:
        db.query(OidcProvider).delete()
        db.commit()
    _legacy(provider, label="authentik")
    oidc_store.migrate_settings(backup=False)
    assert _entries()[0].managed == ""


def test_nothing_set_up_before_moves_nothing(client: TestClient, operator: Account) -> None:
    assert oidc_store.migrate_settings(backup=False) is None and _entries() == []
    with SessionLocal() as db:
        assert settings_service.get(db, oidc_store.MIGRATED) is True


def _coupled_0_3(own: FakeProvider, suite_fake: FakeProvider) -> None:
    """An installation coupled to nexsuite under 0.3.0: the settings hold nexsuite, the own provider waits in
    ``suite_saved``; anna and the operator are persons 2 and 1 there, anna's own authentik link waits apart."""
    make_account("anna")
    make_account("cleo")
    with SessionLocal() as db:
        settings_service.save(db, {
            "suite_state": "connected",
            "suite_url": "https://suite.example.com",
            "suite_emergency_account": db.scalar(select(Account.id).where(Account.name == "tester")),
            "oidc_issuer": suite_fake.issuer,
            "oidc_client_id": suite_fake.client_id,
            "oidc_client_secret_enc": encrypt_secret(suite_fake.client_secret),
            "oidc_provider_name": "nexsuite",
            "suite_saved": {
                "oidc_issuer": own.issuer, "oidc_client_id": own.client_id,
                "oidc_client_secret_enc": encrypt_secret(own.client_secret), "oidc_provider_name": "authentik",
                "oidc_auto_create": False, "password_login": True, "roles": {},
            },
            oidc_store.MIGRATED: False,
        })
        for name, person, local in (("tester", "1", ""), ("anna", "2", "own-anna"), ("cleo", "", "own-cleo")):
            row = db.scalar(select(Account).where(Account.name == name))
            assert row is not None
            row.oidc_subject, row.suite_person, row.oidc_subject_local = person, person, local
            if name != "tester" and person:
                row.sign_in = SIGN_IN_OIDC
        db.commit()


def test_a_coupled_installation_moves_with_nexsuite_as_the_coupled_entry_and_the_own_one_set_aside(
    client: TestClient, operator: Account, provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    suite_fake = provider.network.add(FakeProvider("https://suite.example.com"))  # type: ignore[attr-defined]
    own = provider.network.add(FakeProvider("https://auth.example.com/application/o/nexcanvas/"))  # type: ignore[attr-defined]
    _coupled_0_3(own, suite_fake)
    oidc_store.migrate_settings(backup=False)
    entries = {row.slug: row for row in _entries()}
    assert set(entries) == {"oidc", "oidc-own"}
    coupled, parked = entries["oidc"], entries["oidc-own"]
    assert (coupled.managed, coupled.enabled, coupled.issuer, coupled.label) == ("nexsuite", True, suite_fake.issuer, "nexsuite")
    assert (parked.managed, parked.enabled, parked.label) == ("authentik", False, "authentik")
    assert parked.redirect_path == "/api/oidc/callback", "the own provider knows the old address"
    assert _links(coupled.id) == [("1", "tester"), ("2", "anna")]
    assert _links(parked.id) == [("own-anna", "anna"), ("own-cleo", "cleo")]
    with SessionLocal() as db:
        assert isinstance(settings_service.get(db, "suite_coupling"), dict)
    # Signing in through nexsuite as person 2 is anna, through the old address.
    suite_fake.person = {"sub": "2", "preferred_username": "anna"}
    browser = fresh_browser()
    target = location(browser.get("/api/oidc/oidc/start"))
    assert location(browser.get("/api/oidc/callback", params=suite_fake.authorize(target))) == "/"
    assert browser.get("/api/auth/me").json()["name"] == "anna"
    # A second start does nothing.
    assert oidc_store.migrate_settings(backup=False) is None and len(_entries()) == 2
    # Disconnecting (nexsuite has forgotten the app): the own entry is back as "oidc", with its links.
    monkeypatch.setattr(suite, "request", lambda *_a, **_k: (_ for _ in ()).throw(suite.SuiteError("suite_refused", "gone")))
    with SessionLocal() as db:
        suite.disconnect(db, tell=True)
    [back] = _entries()
    # Its own slug again, and with it the old address (``redirect_path`` back to the standard of "oidc").
    assert (back.slug, back.managed, back.enabled, back.redirect_path) == ("oidc", "authentik", True, "")
    assert _links(back.id) == [("own-anna", "anna"), ("own-cleo", "cleo")]
    own.person = {"sub": "own-cleo", "preferred_username": "cleo"}
    browser = fresh_browser()
    target = location(browser.get("/api/oidc/oidc/start"))
    assert "%2Fapi%2Foidc%2Fcallback" in target
    assert location(browser.get("/api/oidc/callback", params=own.authorize(target))) == "/"
    assert browser.get("/api/auth/me").json()["name"] == "cleo"


# --- The address a provider gives (blueprint 01, "Wer ist das?", last paragraph) -------------------------------------


def test_an_account_through_the_provider_only_follows_its_address_never_one_of_another_account(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    configure(client, provider)
    make_account("bea")
    with SessionLocal() as db:
        db.query(Account).filter_by(name="bea").one().email = "taken@example.com"
        db.commit()
    browser = fresh_browser()
    sign_in_via_oidc(browser, provider, sub="p-1", preferred_username="neo", email="neo@example.com")
    neo = _row("neo")
    assert (neo.sign_in, neo.email, neo.email_source) == ("oidc", "neo@example.com", "provider")
    # The provider says otherwise later: followed; an address another account has: never.
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="neo", email="neo2@example.com")
    assert _row("neo").email == "neo2@example.com"
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="neo", email="TAKEN@example.com")
    assert _row("neo").email == "neo2@example.com"


def test_an_account_with_a_password_is_offered_the_address_and_takes_it_only_when_it_says_so(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    configure(client, provider, auto_create=False)
    alex = make_account("alex")
    member = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(member, alex)
    back = link(member, provider, PASSWORD, sub="p-alex", email="alex@example.com")
    assert error_in(back) is None
    assert _row("alex").email == ""
    me = member.get("/api/auth/me").json()
    assert me["provider_email"] == "alex@example.com"
    assert member.post("/api/oidc/me/address").json() == {"email": "alex@example.com"}
    row = _row("alex")
    assert (row.email, row.email_source, row.provider_email) == ("alex@example.com", "provider", "")
    assert member.get("/api/auth/me").json()["provider_email"] == ""
    # Unlinking the last link: the address that came from the provider goes too.
    assert member.delete("/api/oidc/sso/link").status_code == 204
    assert _row("alex").email == ""


def test_dont_ask_again_keeps_the_offer_away_and_an_own_address_stays_when_the_link_goes(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    configure(client, provider, auto_create=False)
    alex = make_account("alex")
    with SessionLocal() as db:
        db.query(Account).filter_by(name="alex").one().email = "own@example.com"
        db.commit()
    member = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(member, alex)
    link(member, provider, PASSWORD, sub="p-alex", email="alex@example.com")
    assert member.get("/api/auth/me").json()["provider_email"] == "alex@example.com"
    assert member.delete("/api/oidc/me/address").status_code == 204
    assert member.get("/api/auth/me").json()["provider_email"] == ""
    assert member.post("/api/oidc/me/address").status_code == 409
    assert member.delete("/api/oidc/sso/link").status_code == 204
    assert _row("alex").email == "own@example.com"


def test_an_address_from_a_provider_stays_while_another_link_holds(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    second = provider.network.add(FakeProvider("https://second.example.com"))  # type: ignore[attr-defined]
    configure(client, provider)
    add_provider(client, second, slug="second", label="Second")
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="neo", email="neo@example.com")
    with SessionLocal() as db:
        neo = db.query(Account).filter_by(name="neo").one()
        entry = db.query(OidcProvider).filter_by(slug="second").one()
        db.add(OidcLink(provider_id=entry.id, subject="s-1", account_id=neo.id, issuer=entry.issuer))
        db.commit()
        first = db.query(OidcProvider).filter_by(slug="sso").one().id
    assert client.delete(f"/api/oidc/admin/providers/{first}").status_code == 200
    assert _row("neo").email == "neo@example.com", "the second link still holds"
    with SessionLocal() as db:
        second_id = db.query(OidcProvider).filter_by(slug="second").one().id
    assert client.delete(f"/api/oidc/admin/providers/{second_id}").status_code == 200
    assert _row("neo").email == ""


# --- The operator ---------------------------------------------------------------------------------------------------


def test_the_account_list_marks_the_providers_and_the_operator_unlinks_with_a_notice(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = configure(client, provider, auto_create=False)
    alex = make_account("alex")
    member = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(member, alex)
    link(member, provider, PASSWORD, sub="p-alex")
    listed = {row["name"]: row for row in client.get("/api/accounts").json()}
    assert listed["alex"]["providers"] == [{"id": entry["id"], "slug": "sso", "label": "Test SSO", "managed": ""}]
    assert listed["tester"]["providers"] == []
    refused = client.request("DELETE", f"/api/oidc/admin/accounts/{alex.id}/links/{entry['id']}",
                             json={"current_password": "not the password"})
    assert refused.status_code == 401
    done = client.request("DELETE", f"/api/oidc/admin/accounts/{alex.id}/links/{entry['id']}",
                          json={"current_password": PASSWORD})
    assert done.status_code == 204, done.text
    with SessionLocal() as db:
        notice = db.query(SpaceNotice).filter_by(account_id=alex.id).one()
        assert (notice.kind, notice.subject, notice.actor, notice.space_id) == ("operator_unlinked", "Test SSO", "tester", None)
    seen = member.get("/api/notices").json()
    assert [item["kind"] for item in seen] == ["operator_unlinked"]


def test_the_password_switch_needs_an_active_provider(client: TestClient, operator: Account,
                                                      provider: FakeProvider) -> None:
    refused = client.put("/api/settings", json={"password_login": False})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "provider_first"
    configure(client, provider, enabled=False)
    refused = client.put("/api/settings", json={"password_login": False})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "provider_first"
    entry = _entries()[0]
    body = {"label": entry.label, "issuer": entry.issuer, "client_id": entry.client_id, "enabled": True}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    assert client.put("/api/settings", json={"password_login": False}).status_code == 200
    # The operator always gets in with the password (the way back when the provider fails).
    methods = fresh_browser().get("/api/auth/methods").json()
    assert methods["password"] is False and methods["providers"] == [{"slug": "sso", "label": "Test SSO"}]


# --- Two instances on one host -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("suffix", ["_a", "_suite"])
def test_two_instances_on_one_host_keep_their_attempts_apart(
    client: TestClient, operator: Account, provider: FakeProvider, monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    configure(client, provider)
    monkeypatch.setattr(get_settings(), "cookie_suffix", suffix)
    oidc_store.configure()
    try:
        browser = fresh_browser()
        target = location(browser.get("/api/oidc/sso/start", params={"next": "/b/1"}))
        assert browser.cookies.get(f"nexcanvas_oidc{suffix}") and browser.cookies.get(f"nexcanvas_oidc_next{suffix}")
        assert browser.cookies.get("nexcanvas_oidc") is None
        # The other instance's attempt (no suffix) is not this one's.
        other = fresh_browser()
        other.cookies.set("nexcanvas_oidc", browser.cookies.get(f"nexcanvas_oidc{suffix}") or "", path="/api/oidc")
        params = provider.authorize(target)
        assert error_in(other.get("/api/oidc/sso/callback", params=params)) == "oidc_state_mismatch"
        assert location(browser.get("/api/oidc/sso/callback", params=params)) == "/b/1"
    finally:
        monkeypatch.setattr(get_settings(), "cookie_suffix", "")
        oidc_store.configure()


# --- The log ------------------------------------------------------------------------------------------------------


def test_no_secret_leaves_a_trace_in_the_log(client: TestClient, operator: Account, provider: FakeProvider,
                                             caplog: pytest.LogCaptureFixture) -> None:
    configure(client, provider)
    caplog.set_level(logging.DEBUG)
    browser = fresh_browser()
    target = location(browser.get("/api/oidc/sso/start"))
    params = provider.authorize(target)
    back = browser.get("/api/oidc/sso/callback", params=params)
    assert location(back) == "/"
    sent = oidc_helpers.fakes.query_of(target)
    log = caplog.text
    for secret in (provider.client_secret, params["code"], params["state"], sent["code_challenge"], sent["nonce"]):
        assert secret not in log
    assert "alex@example.com" not in log


def test_a_blocked_account_does_not_come_in_through_the_provider(client: TestClient, operator: Account,
                                                                 provider: FakeProvider) -> None:
    configure(client, provider)
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="neo")
    neo = _row("neo")
    assert client.post(f"/api/accounts/{neo.id}/block", json={"current_password": PASSWORD}).status_code == 204
    browser = fresh_browser()
    back = sign_in_via_oidc(browser, provider, sub="p-1", preferred_username="neo")
    assert error_in(back) == "account_blocked" and browser.get("/api/auth/me").status_code == 401


def _way_back() -> tuple[str, str, list[str]]:
    with SessionLocal() as db:
        subjects = sorted(subject for subject in db.scalars(select(Account.oidc_subject)) if subject)
        return str(settings_service.get(db, "oidc_issuer")), str(settings_service.get(db, "oidc_client_id")), subjects


def test_removing_the_entry_oidc_takes_the_way_back_of_0_3_along(client: TestClient, operator: Account,
                                                                 provider: FakeProvider) -> None:
    """The settings and the column of 0.3 describe the same issuer or nothing: removed here, a return to 0.3 must not
    bring the provider back with its subjects."""
    make_account("anna")
    _legacy(provider, label="Company", subjects={"anna": "anna-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None and _way_back() == (provider.issuer, provider.client_id, ["anna-1"])
    assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
    assert _way_back() == ("", "", [])


def test_another_issuer_for_the_entry_oidc_takes_the_way_back_of_0_3_along_the_same_one_not(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    other = provider.network.add(FakeProvider("https://other.example.com"))  # type: ignore[attr-defined]
    make_account("anna")
    _legacy(provider, label="Company", subjects={"anna": "anna-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    body = {"label": "Company", "issuer": provider.issuer + "/", "client_id": provider.client_id}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    assert _way_back() == (provider.issuer, provider.client_id, ["anna-1"]), "the same issuer, written with a slash"
    body = {"label": "Company", "issuer": other.issuer, "client_id": provider.client_id}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    assert _way_back() == ("", "", [])


def test_another_entry_leaves_the_way_back_of_0_3_alone(client: TestClient, operator: Account,
                                                        provider: FakeProvider) -> None:
    second = provider.network.add(FakeProvider("https://second.example.com"))  # type: ignore[attr-defined]
    make_account("anna")
    _legacy(provider, label="Company", subjects={"anna": "anna-1"})
    oidc_store.migrate_settings(backup=False)
    made = add_provider(client, second, slug="second", label="Second")
    assert client.delete(f"/api/oidc/admin/providers/{made['id']}").status_code == 200
    assert _way_back() == (provider.issuer, provider.client_id, ["anna-1"])


def test_a_start_without_a_page_forgets_the_page_of_an_earlier_start(client: TestClient, operator: Account,
                                                                     provider: FakeProvider) -> None:
    configure(client, provider)
    browser = fresh_browser()
    location(browser.get("/api/oidc/sso/start", params={"next": "/b/old"}))
    assert (browser.cookies.get("nexcanvas_oidc_next") or "").strip('"') == "/b/old"
    target = location(browser.get("/api/oidc/sso/start"))
    assert browser.cookies.get("nexcanvas_oidc_next") is None
    assert location(oidc_helpers.come_back(browser, provider, target)) == "/"


def test_unlinking_from_the_entry_oidc_takes_the_subject_of_0_3_along(client: TestClient, operator: Account,
                                                                     provider: FakeProvider) -> None:
    """By the account itself and by the operator: unlinked on purpose, nobody comes in again on 0.3."""
    anna = make_account("anna")
    make_account("ben")
    _legacy(provider, label="Company", subjects={"anna": "anna-1", "ben": "ben-1", "tester": "tester-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    member = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(member, anna)
    assert member.delete("/api/oidc/oidc/link").status_code == 204
    assert _way_back()[2] == ["ben-1", "tester-1"]
    ben = _row("ben")
    done = client.request("DELETE", f"/api/oidc/admin/accounts/{ben.id}/links/{entry.id}",
                          json={"current_password": PASSWORD})
    assert done.status_code == 204, done.text
    assert _way_back() == (provider.issuer, provider.client_id, ["tester-1"])

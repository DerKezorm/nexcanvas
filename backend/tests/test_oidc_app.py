"""nexcanvas' own side of sign-in through providers, around the shared contract tests (``tests/nexoidc``): the
migration from the single provider of 0.3 (on its own and while coupled to nexsuite), the address a provider gives,
the operator's account list and unlinking, the password switch, the attempt cookie of two instances on one host, and
the log.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    MANAGE,
    READ,
    SIGN_IN_OIDC,
    WRITE,
    Account,
    Invite,
    Membership,
    OidcLink,
    OidcProvider,
    Space,
    SpaceNotice,
)
from app.security import decrypt_secret, encrypt_secret
from app.services import accounts, backups, oidc_store, settings_service, suite

from . import oidc_helpers
from .conftest import PASSWORD, make_account, sign_in
from .oidc_helpers import (
    FakeProvider,
    add_provider,
    come_back,
    configure,
    error_in,
    fresh_browser,
    link,
    location,
    sign_in_via_oidc,
    start,
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


def test_removing_every_entry_after_the_migration_brings_the_old_provider_back_never_by_itself(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _legacy(provider, label="Company")
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
    # The way back is empty with it: a start finds nothing 0.3 could have set up, and makes nothing.
    assert oidc_store.migrate_settings(backup=False) is None and _entries() == []
    assert _way_back() == ("", "", [])
    # Set up in 0.3 after all (the settings written by that older version): that is a change of 0.3 and is taken over.
    with SessionLocal() as db:
        settings_service.save(db, {"oidc_issuer": provider.issuer, "oidc_client_id": provider.client_id})
    assert oidc_store.migrate_settings(backup=False) is None
    assert [row.slug for row in _entries()] == ["oidc"]


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


def test_another_issuer_for_the_entry_oidc_gives_the_way_back_of_0_3_the_new_issuer_without_the_persons(
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
    assert _way_back() == (other.issuer, provider.client_id, []), "the new issuer, and nobody of the old one"


@pytest.mark.parametrize(("enabled", "auto_create", "old", "found"), [
    (True, True, True, True), (False, True, False, False), (True, False, False, True), (False, False, False, False)])
def test_the_way_back_of_0_3_lets_nobody_in_through_an_entry_that_is_off_and_nobody_new_through_one_without_accounts(
    client: TestClient, operator: Account, provider: FakeProvider, enabled: bool, auto_create: bool, old: bool,
    found: bool
) -> None:
    """0.3 knows one provider and one switch "make new accounts": the entry without new accounts here is a 0.3 that
    lets nobody new in through it. The entry switched off is a 0.3 without the provider: it would let the linked
    persons in (0.3.0 knows no switch to turn the provider off)."""
    _legacy(provider, label="Company", auto_create=not old)
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    body = {"label": "Company", "issuer": provider.issuer, "client_id": provider.client_id, "enabled": enabled,
            "auto_create": auto_create}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_auto_create") is old
        assert (settings_service.get(db, "oidc_issuer") == provider.issuer) is found


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


# --- Module 1.0.8: an invitation at a known link, the way back without the second factor of the provider ------------


def _space_with_invite(role: str) -> tuple[int, str]:
    """A space the operator manages and an invitation into it with ``role``."""
    with SessionLocal() as db:
        boss = db.scalar(select(Account).where(Account.role == "operator"))
        assert boss is not None
        space = Space(name="Studio")
        db.add(space)
        db.flush()
        db.add(Membership(space_id=space.id, account_id=boss.id, role=MANAGE))
        db.commit()
        _invite, token = accounts.create_invite(db, boss, space_id=space.id, space_role=role, days=7)
        return space.id, token


def _right_in(space_id: int, name: str) -> str | None:
    with SessionLocal() as db:
        return db.scalar(select(Membership.role).join(Account, Account.id == Membership.account_id)
                         .where(Membership.space_id == space_id, Account.name == name))


@pytest.mark.parametrize(("before", "after"), [(None, WRITE), (READ, WRITE), (WRITE, WRITE), (MANAGE, MANAGE)])
def test_an_invitation_at_a_known_link_adds_its_right_to_the_account_and_never_takes_one_away(
    client: TestClient, operator: Account, provider: FakeProvider, before: str | None, after: str
) -> None:
    configure(client, provider)
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="dora")
    space_id, token = _space_with_invite(WRITE)
    if before is not None:
        with SessionLocal() as db:
            db.add(Membership(space_id=space_id, account_id=_row("dora").id, role=before))
            db.commit()
    browser = fresh_browser()
    assert location(sign_in_via_oidc(browser, provider, sub="p-1", preferred_username="dora", invite=token)) == "/"
    assert browser.get("/api/auth/me").json()["name"] == "dora"
    assert _right_in(space_id, "dora") == after
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Invite)) == 0, "the invitation is used up"
    assert len(_entries()) == 1 and _row("dora").name == "dora"


def test_an_invitation_used_meanwhile_still_lets_a_known_link_in_without_the_right(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    configure(client, provider)
    sign_in_via_oidc(fresh_browser(), provider, sub="p-1", preferred_username="dora")
    space_id, token = _space_with_invite(WRITE)
    browser = fresh_browser()
    where = start(browser, invite=token)
    with SessionLocal() as db:
        db.execute(delete(Invite))
        db.commit()
    assert location(come_back(browser, provider, where)) == "/"
    assert browser.get("/api/auth/me").json()["name"] == "dora" and _right_in(space_id, "dora") is None


def _held_way_back() -> tuple[str, str, str, str, bool]:
    """Issuer, client, the secret (opened: it is sealed afresh when it comes back), name and "make accounts"."""
    with SessionLocal() as db:
        return (str(settings_service.get(db, "oidc_issuer")), str(settings_service.get(db, "oidc_client_id")),
                decrypt_secret(str(settings_service.get(db, "oidc_client_secret_enc") or "")),
                str(settings_service.get(db, "oidc_provider_name")), bool(settings_service.get(db, "oidc_auto_create")))


def _put_entry(client: TestClient, entry: OidcProvider, provider: FakeProvider, **form: object) -> None:
    body = {"label": "Company", "issuer": provider.issuer, "client_id": provider.client_id, **form}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200


def test_the_way_back_of_0_3_finds_no_provider_while_the_provider_does_not_check_the_second_factor_itself(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """0.3 does not know the switch and would ask for no code: an entry ``oidc`` with it off is an entry that is off
    for 0.3, now, and with it on again the provider is back, with the persons, as it was."""
    make_account("anna")
    _legacy(provider, label="Company", auto_create=True, subjects={"anna": "anna-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    before = _held_way_back()
    assert before[:2] == (provider.issuer, provider.client_id) and before[4] is True
    _put_entry(client, entry, provider, auto_create=True, trusts_second_factor=False)
    assert _held_way_back()[:5] == ("", "", "", "", False), "no client, nobody new"
    assert _way_back() == ("", "", ["anna-1"]), "the persons stay: they are the way back of the switch turned on again"
    _put_entry(client, entry, provider, auto_create=True, trusts_second_factor=True)
    assert _held_way_back() == before


def test_the_way_back_stays_empty_across_saves_while_the_switch_is_off_and_comes_back_off_when_the_entry_is_off(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _legacy(provider, label="Company", auto_create=True)
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    before = _held_way_back()
    _put_entry(client, entry, provider, trusts_second_factor=False, label="Company A")
    _put_entry(client, entry, provider, trusts_second_factor=False, label="Company B")
    assert _held_way_back()[:5] == ("", "", "", "", False)
    # Back on, but the entry itself off: still held, for the second reason.
    _put_entry(client, entry, provider, trusts_second_factor=True, enabled=False, auto_create=True)
    assert _held_way_back()[:5] == ("", "", "", "", False)
    # Both reasons gone: the provider is back for 0.3, and it makes accounts as the entry says.
    _put_entry(client, entry, provider, trusts_second_factor=True, enabled=True, auto_create=True)
    after = _held_way_back()
    assert after == before


def test_the_way_back_of_0_3_finds_no_provider_while_the_entry_is_off_the_persons_stay_and_it_is_back_when_it_is_on(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """The persons linked at the entry would come in on 0.3.0 through an entry that is off: no provider there, and the
    persons stay as the way back of the entry switched on again. With either reason left it stays off."""
    make_account("anna")
    _legacy(provider, label="Company", auto_create=True, subjects={"anna": "anna-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    before = _held_way_back()
    _put_entry(client, entry, provider, auto_create=True, enabled=False)
    assert _held_way_back()[:5] == ("", "", "", "", False) and _way_back() == ("", "", ["anna-1"])
    _put_entry(client, entry, provider, auto_create=True, enabled=False, trusts_second_factor=False)
    _put_entry(client, entry, provider, auto_create=True, enabled=True, trusts_second_factor=False)
    assert _held_way_back()[:5] == ("", "", "", "", False), "the second factor is still no reason to come back"
    _put_entry(client, entry, provider, auto_create=True, enabled=True)
    assert _held_way_back() == before and _way_back()[2] == ["anna-1"]


def test_removing_the_entry_empties_the_way_back_and_another_issuer_gives_it_the_new_one(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    other = provider.network.add(FakeProvider("https://other.example.com"))  # type: ignore[attr-defined]
    for how in ("remove", "issuer"):
        _legacy(provider, label="Company", auto_create=True)
        entry = oidc_store.migrate_settings(backup=False)
        assert entry is not None
        _put_entry(client, entry, provider, trusts_second_factor=False)
        assert _held_way_back()[:5] == ("", "", "", "", False)
        if how == "remove":
            assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
            assert _held_way_back() == ("", "", "", "", False), how
        else:
            body = {"label": "Company", "issuer": other.issuer, "client_id": provider.client_id,
                    "trusts_second_factor": True}
            assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
            assert _held_way_back()[:2] == (other.issuer, provider.client_id), how
        with SessionLocal() as db:
            db.execute(delete(OidcProvider))
            settings_service.save(db, {oidc_store.MIGRATED: False})
            db.commit()


# --- "Second factor required": not forced by a sign-in through a provider that checks it (decided 2026-10-10) -------


def _required_with_linked_password_account(
    client: TestClient, provider: FakeProvider, *, trusts: bool
) -> tuple[Account, dict]:
    made = oidc_helpers.configure(client, provider, auto_create=False, trusts_second_factor=trusts)
    anna = make_account("anna")
    with SessionLocal() as db:
        db.add(OidcLink(provider_id=made["id"], subject="anna-1", account_id=anna.id, issuer=provider.issuer))
        settings_service.save(db, {"two_factor_required": True})
    return anna, made


def _setup_asked(browser: TestClient) -> bool:
    me = browser.get("/api/auth/me")
    assert me.status_code == 200, me.text
    return bool(me.json()["second_factor_setup_required"])


def test_required_second_factor_does_not_force_a_sign_in_through_a_provider_that_checks_it_but_does_the_password(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    anna, _ = _required_with_linked_password_account(client, provider, trusts=True)
    through_provider = fresh_browser()
    assert location(sign_in_via_oidc(through_provider, provider, sub="anna-1", preferred_username="anna")) == "/"
    assert _setup_asked(through_provider) is False
    assert through_provider.get("/api/spaces").status_code == 200
    # The same account with its password: asked, as before.
    with_password = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(with_password, anna)
    assert _setup_asked(with_password) is True
    blocked = with_password.get("/api/spaces")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "second_factor_setup_required"
    # Both sessions side by side: one does not decide for the other.
    assert through_provider.get("/api/spaces").status_code == 200


def test_required_second_factor_still_forces_a_provider_that_does_not_check_it(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _required_with_linked_password_account(client, provider, trusts=False)
    browser = fresh_browser()
    assert location(sign_in_via_oidc(browser, provider, sub="anna-1", preferred_username="anna")) == "/"
    assert _setup_asked(browser) is True
    assert browser.get("/api/spaces").status_code == 403

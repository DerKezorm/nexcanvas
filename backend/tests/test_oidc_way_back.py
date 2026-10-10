"""The way back to nexcanvas 0.3 and up again (module 1.0.9, README "Rückweg und wieder hoch"): the settings and the
column of 0.3 follow the entry ``oidc`` after every change, the fingerprint of what stands there is stored with them,
and a start takes over what 0.3 changed since, and nothing else. The shared contract is in ``tests/nexoidc``
(``test_nexoidc_wayback.py``); this file is nexcanvas' own side: the routes, an account made or deleted, the entry
off and a provider set up by 0.3 meanwhile.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Account, OidcLink, OidcProvider
from app.security import decrypt_secret, encrypt_secret
from app.services import oidc_store, settings_service
from app.vendor.nexoidc import migrate

from . import oidc_helpers
from .conftest import PASSWORD, make_account, sign_in
from .oidc_helpers import FakeProvider, fresh_browser, sign_in_via_oidc
from .test_oidc_app import _legacy, _put_entry, _row

provider = oidc_helpers.provider


def _quiet() -> None:
    """Nothing is left that a start would take for a change of 0.3: the fingerprint stored with the last write is the
    one of what stands in the settings and the column now."""
    with SessionLocal() as db:
        legacy, subjects = oidc_store.read_legacy(db)
        found = migrate.changes(settings_service.get(db, oidc_store.FINGERPRINT), migrate.fingerprint(legacy, subjects))
    assert found.known and not found.any, found


def _migrated(provider: FakeProvider, **subjects: str) -> OidcProvider:
    for name in subjects:
        make_account(name)
    _legacy(provider, label="Company", auto_create=True, subjects=subjects)
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    _quiet()
    return entry  # type: ignore[return-value]


def test_every_change_the_new_version_makes_leaves_the_way_back_and_its_fingerprint_in_step(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider, anna="anna-1", ben="ben-1")
    anna = _row("anna")
    # The form: another name and client, the switches.
    _put_entry(client, entry, provider, label="Renamed", client_id="client-2", client_secret="secret-2")
    _quiet()
    _put_entry(client, entry, provider, label="Renamed", client_id="client-2", trusts_second_factor=False)
    _quiet()
    _put_entry(client, entry, provider, label="Renamed", client_id="client-2", enabled=False)
    _quiet()
    _put_entry(client, entry, provider, label="Renamed", client_id="client-2", auto_create=True)
    _quiet()
    # A person unlinks, the operator unlinks another, an account is deleted, a new person comes in.
    member = TestClient(client.app, base_url="http://testserver", headers=client.headers, follow_redirects=False)
    sign_in(member, anna)
    assert member.delete("/api/oidc/oidc/link").status_code == 204
    _quiet()
    ben = _row("ben")
    done = client.request("DELETE", f"/api/oidc/admin/accounts/{ben.id}/links/{entry.id}",
                          json={"current_password": PASSWORD})
    assert done.status_code == 204, done.text
    _quiet()
    make_account("cleo")
    with SessionLocal() as db:
        db.add(OidcLink(provider_id=entry.id, subject="cleo-1", account_id=_row("cleo").id, issuer=entry.issuer))
        db.commit()
    _quiet()
    with SessionLocal() as db:
        db.delete(db.get(Account, _row("cleo").id))
        db.commit()
    _quiet()
    assert oidc_store.migrate_settings(backup=False) is None
    _quiet()


def test_a_new_account_made_through_the_provider_is_in_the_way_back(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _migrated(provider)
    browser = fresh_browser()
    assert oidc_helpers.location(sign_in_via_oidc(browser, provider, slug="oidc", sub="new-7",
                                                   preferred_username="newbie")) == "/"
    _quiet()
    with SessionLocal() as db:
        assert db.scalar(select(Account.oidc_subject).where(Account.name == "newbie")) == "new-7"


def test_the_secret_of_the_way_back_is_sealed_again_only_when_it_changes(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider)
    with SessionLocal() as db:
        sealed = settings_service.get(db, "oidc_client_secret_enc")
    _put_entry(client, entry, provider, label="Another name")
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_secret_enc") == sealed
    _put_entry(client, entry, provider, label="Another name", client_secret="new-secret")
    with SessionLocal() as db:
        assert decrypt_secret(str(settings_service.get(db, "oidc_client_secret_enc"))) == "new-secret"


def test_a_provider_set_up_by_0_3_while_the_entry_was_off_is_taken_over_and_never_overwritten_by_an_older_copy(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """The entry is off, so the way back is empty. 0.3 sets up another client in it; at the next start the entry takes
    that over and is on. Nothing of what stood before comes back over it, when the entry is saved later."""
    entry = _migrated(provider)
    _put_entry(client, entry, provider, enabled=False)
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_id") == ""
        settings_service.save(db, {
            "oidc_issuer": provider.issuer, "oidc_client_id": "client-of-0-3",
            "oidc_client_secret_enc": encrypt_secret("secret-of-0-3"), "oidc_provider_name": "Set up in 0.3",
        })
    assert oidc_store.migrate_settings(backup=False) is None
    with SessionLocal() as db:
        row = db.scalar(select(OidcProvider).where(OidcProvider.slug == "oidc"))
        assert row is not None and (row.client_id, row.label, row.enabled) == ("client-of-0-3", "Set up in 0.3", True)
    _quiet()
    _put_entry(client, row, provider, client_id="client-of-0-3", label="Set up in 0.3")
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_id") == "client-of-0-3"
        assert decrypt_secret(str(settings_service.get(db, "oidc_client_secret_enc"))) == "secret-of-0-3"


def test_a_start_changes_nothing_when_0_3_changed_nothing(
    client: TestClient, operator: Account, provider: FakeProvider, caplog: Any
) -> None:
    _migrated(provider)
    make_account("anna")
    with SessionLocal() as db:
        row = db.scalar(select(Account).where(Account.name == "anna"))
        assert row is not None
        db.add(OidcLink(provider_id=db.scalar(select(OidcProvider.id)), subject="anna-1", account_id=row.id,
                        issuer=provider.issuer))
        db.commit()
    before = _snapshot()
    caplog.clear()
    for _ in range(2):
        assert oidc_store.migrate_settings(backup=False) is None
    assert _snapshot() == before
    assert not [line for line in caplog.messages if "took over" in line], caplog.messages


def _snapshot() -> Any:
    with SessionLocal() as db:
        entries = [(r.id, r.slug, r.label, r.issuer, r.client_id, r.client_secret_enc, r.enabled, r.auto_create,
                    r.trusts_second_factor, r.managed) for r in db.scalars(select(OidcProvider).order_by(OidcProvider.id))]
        links = sorted((r.provider_id, r.subject, r.account_id) for r in db.scalars(select(OidcLink)))
        return entries, links, settings_service.get(db, oidc_store.FINGERPRINT)


def test_before_the_migration_the_settings_and_the_column_of_0_3_are_not_touched(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """They still wait to be read: a change of the list before the first start with it must not write over them."""
    make_account("anna")
    _legacy(provider, label="Company", subjects={"anna": "anna-1"})
    with SessionLocal() as db:
        db.add(OidcProvider(slug="early", label="Early", issuer="https://early.example.com", client_id="early"))
        db.commit()
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_id") == provider.client_id
        assert db.scalar(select(Account.oidc_subject).where(Account.name == "anna")) == "anna-1"

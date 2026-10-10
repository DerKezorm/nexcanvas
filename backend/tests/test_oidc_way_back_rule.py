"""One rule for the way back to nexcanvas 0.3 (module 1.0.10, ``migrate.way_back``, README "Rückweg und wieder hoch"):
what the old settings and the column show depends on the entry ``oidc`` and on the anchor (the issuer 0.3 knows, or
closed). The shared contract is in ``tests/nexoidc/test_nexoidc_wayback.py``; this is nexcanvas' side: the form and the
routes that change the entry, the start, the backup before a take-over, the row an earlier build left behind.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Account, Setting
from app.security import decrypt_secret, encrypt_secret
from app.services import backups, oidc_store, settings_service
from app.vendor.nexoidc import migrate

from . import oidc_helpers
from .conftest import PASSWORD, make_account
from .oidc_helpers import FakeProvider
from .test_oidc_app import _entries, _legacy, _put_entry, _row
from .test_oidc_way_back import _migrated, _quiet

provider = oidc_helpers.provider


def _shown() -> dict[str, Any]:
    """What 0.3 finds: the old settings (the secret opened) and the column per account name, and the anchor."""
    with SessionLocal() as db:
        legacy, subjects = oidc_store.read_legacy(db)
        names = {row.id: row.name for row in db.scalars(select(Account))}
        return {
            "issuer": legacy.issuer,
            "client": legacy.client_id,
            "secret": legacy.client_secret,
            "label": legacy.label,
            "auto_create": legacy.auto_create,
            "subjects": {names[account_id]: subject for account_id, subject in subjects},
            "anchor": settings_service.get(db, oidc_store.ANCHOR),
        }


def _written_by_0_3(provider: FakeProvider, *, issuer: str | None = None, label: str = "Set up in 0.3",
                    client_id: str | None = None, subjects: dict[str, str] | None = None) -> None:
    """0.3 at work while this version was away: its own settings and column, written as it writes them."""
    with SessionLocal() as db:
        settings_service.save(db, {
            "oidc_issuer": provider.issuer if issuer is None else issuer,
            "oidc_client_id": provider.client_id if client_id is None else client_id,
            "oidc_client_secret_enc": encrypt_secret(provider.client_secret),
            "oidc_provider_name": label,
        })
        for name, subject in (subjects or {}).items():
            row = db.scalar(select(Account).where(Account.name == name))
            assert row is not None
            row.oidc_subject = subject
        db.commit()


def _other(provider: FakeProvider) -> FakeProvider:
    return provider.network.add(FakeProvider("https://other.example.com"))  # type: ignore[attr-defined,no-any-return]


def test_off_leaves_issuer_name_and_persons_and_takes_only_the_client_so_0_3_lets_nobody_in(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider, anna="anna-1")
    on = _shown()
    assert (on["issuer"], on["client"], on["label"], on["auto_create"], on["anchor"]) == (
        provider.issuer, provider.client_id, "Company", True, provider.issuer)
    _put_entry(client, entry, provider, enabled=False, auto_create=True)
    off = _shown()
    assert (off["issuer"], off["label"], off["subjects"]) == (provider.issuer, "Company", {"anna": "anna-1"})
    assert (off["client"], off["secret"], off["auto_create"]) == ("", "", False), "without a client 0.3 lets nobody in"
    assert off["anchor"] == provider.issuer
    # Or only the second factor not checked: the same.
    _put_entry(client, entry, provider, enabled=True, auto_create=True, trusts_second_factor=False)
    assert _shown() == off
    # On again: everything comes back at once.
    _put_entry(client, entry, provider, enabled=True, auto_create=True)
    assert _shown() == on
    _quiet()


def test_another_issuer_in_the_form_closes_the_way_back_for_good_0_3_finds_no_provider_and_no_mail_bridge(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """Else 0.3 would take the new issuer, find no subject of its own, and let a stranger with a confirmed address in
    as the account that has that address (its bridge over the mail) or make an account for them (``auto_create``)."""
    other = _other(provider)
    entry = _migrated(provider, anna="anna-1")
    body = {"label": "Company", "issuer": other.issuer, "client_id": provider.client_id, "auto_create": True}
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    closed = _shown()
    assert closed == {"issuer": "", "client": "", "secret": "", "label": "", "auto_create": False, "subjects": {},
                      "anchor": migrate.CLOSED}
    # Off and on, and the old issuer put back: still closed (the issuer alone opens nothing).
    _put_entry(client, entry, provider, enabled=False)
    _put_entry(client, entry, other, enabled=True, client_id=provider.client_id)
    body["issuer"] = provider.issuer
    assert client.put(f"/api/oidc/admin/providers/{entry.id}", json=body).status_code == 200
    assert _shown() == closed
    _quiet()


def test_removing_the_entry_closes_the_way_back_and_an_entry_made_by_hand_after_it_does_not_open_it(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider, anna="anna-1")
    assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
    closed = _shown()
    assert closed["issuer"] == closed["client"] == closed["label"] == "" and closed["subjects"] == {}
    assert closed["anchor"] == migrate.CLOSED
    made = client.post("/api/oidc/admin/providers", json={
        "label": "Again", "issuer": provider.issuer, "client_id": provider.client_id, "client_secret": "x"})
    assert made.status_code == 201, made.text
    assert _shown() == closed
    _quiet()


def test_a_provider_that_0_3_sets_up_after_the_way_back_was_closed_opens_it_again(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    other = _other(provider)
    entry = _migrated(provider, anna="anna-1")
    assert client.delete(f"/api/oidc/admin/providers/{entry.id}").status_code == 200
    _written_by_0_3(provider, issuer=other.issuer, label="From 0.3", subjects={"anna": "anna-9"})
    assert oidc_store.migrate_settings(backup=False) is None
    [row] = _entries()
    assert (row.issuer, row.label, row.enabled) == (other.issuer, "From 0.3", True)
    shown = _shown()
    assert (shown["issuer"], shown["anchor"], shown["subjects"]) == (other.issuer, other.issuer, {"anna": "anna-9"})
    _quiet()


def test_off_then_removed_in_0_3_takes_the_entry_with_its_persons_and_closes_the_way_back(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider, anna="anna-1")
    _put_entry(client, entry, provider, enabled=False)
    # 0.3's "remove provider": no issuer, no client, the persons it keeps in the column are cleared by it as well.
    with SessionLocal() as db:
        settings_service.save(db, {"oidc_issuer": "", "oidc_client_id": "", "oidc_client_secret_enc": "",
                                   "oidc_provider_name": ""})
        db.scalar(select(Account).where(Account.name == "anna")).oidc_subject = ""  # type: ignore[union-attr]
        db.commit()
    assert oidc_store.migrate_settings(backup=False) is None
    assert _entries() == []
    assert _shown()["anchor"] == migrate.CLOSED
    _quiet()


def test_a_start_without_any_provider_stores_the_fingerprint_and_a_provider_0_3_sets_up_later_comes_in(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    assert oidc_store.migrate_settings(backup=False) is None
    with SessionLocal() as db:
        assert settings_service.get(db, oidc_store.ANCHOR) == migrate.CLOSED
    _quiet()
    _written_by_0_3(provider)
    assert oidc_store.migrate_settings(backup=False) is None
    [row] = _entries()
    assert (row.issuer, row.client_id, row.enabled) == (provider.issuer, provider.client_id, True)
    assert _shown()["anchor"] == provider.issuer


def test_deleting_an_account_leaves_the_next_start_quiet_no_take_over_and_no_backup(
    client: TestClient, operator: Account, provider: FakeProvider, caplog: pytest.LogCaptureFixture
) -> None:
    _migrated(provider, anna="anna-1", ben="ben-1")
    before = len(backups.entries())
    gone = client.request("DELETE", f"/api/accounts/{_row('ben').id}", json={"current_password": PASSWORD})
    assert gone.status_code == 204, gone.text
    assert _shown()["subjects"] == {"anna": "anna-1"}
    _quiet()
    caplog.clear()
    with caplog.at_level(logging.INFO):
        assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before, "a start that takes over nothing makes no backup"
    assert not [line for line in caplog.messages if "took over" in line], caplog.messages


def test_a_backup_goes_first_when_a_start_takes_over_what_0_3_changed_and_not_otherwise(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _migrated(provider, anna="anna-1")
    before = len(backups.entries())
    assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before, "nothing changed: no backup"
    _written_by_0_3(provider, label="Renamed in 0.3")
    assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before + 1 and backups.entries()[0].kind == backups.UPDATE
    [row] = _entries()
    assert row.label == "Renamed in 0.3", "and it was taken over"
    assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before + 1, "the second start has nothing to take over"


def test_the_start_removes_the_copy_of_the_old_settings_an_earlier_build_kept(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    _migrated(provider)
    with SessionLocal() as db:
        db.add(Setting(key=oidc_store.HELD_COPY, value={"oidc_issuer": provider.issuer,
                                                        "oidc_client_secret_enc": encrypt_secret("old")}))
        db.commit()
    assert oidc_store.migrate_settings(backup=False) is None
    with SessionLocal() as db:
        assert db.get(Setting, oidc_store.HELD_COPY) is None
    _quiet()


def test_the_secret_of_the_way_back_is_the_entrys_and_stays_when_nothing_about_it_changes(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    entry = _migrated(provider)
    with SessionLocal() as db:
        sealed = settings_service.get(db, "oidc_client_secret_enc")
        assert decrypt_secret(str(sealed)) == provider.client_secret
    _put_entry(client, entry, provider, label="Renamed")
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_secret_enc") == sealed, "not sealed afresh for the same secret"
    # Off and on: sealed afresh (nothing to keep while off), but the same secret.
    _put_entry(client, entry, provider, label="Renamed", enabled=False)
    with SessionLocal() as db:
        assert settings_service.get(db, "oidc_client_secret_enc") == ""
    _put_entry(client, entry, provider, label="Renamed", enabled=True)
    with SessionLocal() as db:
        assert decrypt_secret(str(settings_service.get(db, "oidc_client_secret_enc"))) == provider.client_secret


def test_the_issuer_goes_back_letter_by_letter_as_0_3_knew_it_also_with_the_slash_authentik_gives(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """0.3 compares the stored issuer with the new one character by character when it saves a provider and drops every
    subject on a difference: a slash taken off on the way back would make its authentik button lose all links."""
    slashed = provider.issuer + "/"
    make_account("anna")
    _legacy(provider, label="Company", issuer=slashed, auto_create=True, subjects={"anna": "anna-1"})
    entry = oidc_store.migrate_settings(backup=False)
    assert entry is not None
    _quiet()
    assert _shown()["issuer"] == slashed and _shown()["anchor"] == slashed
    before = len(backups.entries())
    # Off and on, a change of the name, a link made and a start: the text stays as 0.3 wrote it.
    _put_entry(client, entry, provider, enabled=False, auto_create=True)
    assert _shown()["issuer"] == slashed
    _put_entry(client, entry, provider, enabled=True, auto_create=True)
    assert _shown()["issuer"] == slashed
    _put_entry(client, entry, provider, label="Renamed", enabled=True, auto_create=True)
    shown = _shown()
    assert (shown["issuer"], shown["anchor"], shown["client"], shown["subjects"]) == (
        slashed, slashed, provider.client_id, {"anna": "anna-1"})
    assert oidc_store.migrate_settings() is None
    assert _shown() == shown and len(backups.entries()) == before, "the start changes nothing and makes no backup"
    _quiet()


def test_a_start_with_a_fingerprint_of_1_0_9_and_nothing_changed_makes_no_backup(
    client: TestClient, operator: Account, provider: FakeProvider
) -> None:
    """The first start with a database of module 1.0.9: compared in the form it stored, so no change is seen and the
    backup that goes before a take-over is not made for nothing."""
    _migrated(provider, anna="anna-1")
    with SessionLocal() as db:
        legacy, subjects = oidc_store.read_legacy(db)
        settings_service.save(db, {oidc_store.FINGERPRINT: migrate._fingerprint(legacy, subjects, "nexoidc-fp1")})
    before = len(backups.entries())
    assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before
    _quiet()
    # And when 0.3 changed something since, the same fingerprint of 1.0.9 shows it: the backup goes first.
    with SessionLocal() as db:
        legacy, subjects = oidc_store.read_legacy(db)
        settings_service.save(db, {oidc_store.FINGERPRINT: migrate._fingerprint(legacy, subjects, "nexoidc-fp1")})
    _written_by_0_3(provider, label="Renamed in 0.3")
    assert oidc_store.migrate_settings() is None
    assert len(backups.entries()) == before + 1
    [row] = _entries()
    assert row.label == "Renamed in 0.3"
    _quiet()

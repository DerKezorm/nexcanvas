"""What the night check of 04.10.2026 found in nexcanvas, each as it should be now (the numbers are those of the
list in nexsuite/tools/pruefgang-2026-10-04/LISTE.md)."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any, Self

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Account, Space, utcnow
from app.services import cleanup, settings_service, suite

from . import test_suite, test_totp
from .conftest import PASSWORD, join, make_account, new_client, sign_in
from .test_suite import SUITE, FakeSuite, connect

# The fixtures of the suite tests, under the names pytest looks for.
fake = test_suite.fake
world = test_suite.world
clock = test_totp.clock


def _board(client: TestClient, space: int, title: str = "Plan") -> str:
    made = client.post("/api/boards", json={"space_id": space, "title": title})
    assert made.status_code == 201, made.text
    return str(made.json()["id"])


def test_a8_a_public_page_of_a_space_in_the_bin_is_gone(client: TestClient, operator: Account, space: int) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
        db.commit()
    board = _board(client, space)
    token = client.put(f"/api/boards/{board}/share", json={"days": 7}).json()["link"].rsplit("/", 1)[1]
    with new_client() as visitor:
        assert visitor.get(f"/api/public/{token}").status_code == 200
        assert client.delete(f"/api/spaces/{space}").status_code == 204
        assert visitor.get(f"/api/public/{token}").status_code == 404


def test_a9_connected_what_nexsuite_keeps_stays_shut(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    invite = client.post(f"/api/spaces/{world['studio']}/invites", json={"role": "manage", "days": 7})
    token = invite.json()["link"].rsplit("/", 1)[1]
    connect(client, world, operator)
    for answer in (
        client.put("/api/settings", json={"public_url": "https://other.example.com"}),
        client.delete("/api/oidc/link"),
        client.post("/api/backups/nexcanvas-2026-10-04-120000.zip/restore", json={"password": PASSWORD}),
    ):
        assert answer.status_code == 409 and answer.json()["detail"]["code"] == "managed_by_suite", answer.text
    with new_client(world["ben"]) as ben:
        joined = ben.post(f"/api/invite/{token}/join")
        assert joined.status_code == 409 and joined.json()["detail"]["code"] == "managed_by_suite"


def test_a13_a_refusal_is_no_reason_to_leave(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite, monkeypatch: Any
) -> None:
    connect(client, world, operator)

    def refused(*_args: Any, **_kwargs: Any) -> Any:
        raise suite.SuiteError("suite_failed", "nexsuite refused.", 409)

    monkeypatch.setattr(suite, "request", refused)
    with SessionLocal() as db:
        assert suite.sync(db) is False
        assert settings_service.get(db, "suite_state") == "connected"


def test_a13_the_code_decides(monkeypatch: Any) -> None:
    import httpx

    class Client:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def request(self, *_: Any, **__: Any) -> httpx.Response:
            return httpx.Response(401, json={"detail": {"code": Client.code}})

    monkeypatch.setattr(suite.httpx, "Client", Client)
    for code, expected in (("app_unknown", "suite_refused"), ("sign_in_first", "suite_failed")):
        Client.code = code
        try:
            suite.request("GET", SUITE + "/api/connect/v1/directory", token="nxs_x")
        except suite.SuiteError as exc:
            assert exc.code == expected, code
        else:
            raise AssertionError("no error")


def test_a14_a_space_without_a_right_answers_as_if_there_were_none(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    connect(client, world, operator)
    with new_client(world["ben"]) as ben:
        for answer in (
            ben.patch(f"/api/spaces/{world['ideen']}", json={"name": "x"}),
            ben.delete(f"/api/spaces/{world['ideen']}"),
        ):
            assert answer.status_code == 404, answer.text


def test_d9_for_good_takes_the_right_to_manage(client: TestClient, operator: Account, space: int) -> None:
    board = _board(client, space)
    make_account("wim")
    join(client, space, "wim", "write")
    with new_client() as wim:
        sign_in(wim, Account(id=_id("wim"), name="wim"))
        assert wim.delete(f"/api/boards/{board}").status_code == 204, "into the bin, as before"
        assert wim.delete(f"/api/boards/{board}/purge").status_code in (403, 404)
    assert client.delete(f"/api/boards/{board}/purge").status_code == 204


def _id(name: str) -> int:
    with SessionLocal() as db:
        return db.query(Account).filter_by(name=name).one().id


def test_d4_the_operator_sees_and_brings_back_every_space_in_the_bin(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    with new_client(anna) as browser:
        own = browser.post("/api/spaces", json={"name": "Annas"}).json()["id"]
        assert browser.delete(f"/api/spaces/{own}").status_code == 204
    assert [s["id"] for s in client.get("/api/spaces/bin").json()] == [own]
    assert client.post(f"/api/spaces/{own}/restore").status_code == 200


def test_e3_a_space_from_nexsuite_waits_for_nexsuite_not_for_the_clock(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    connect(client, world, operator)
    with SessionLocal() as db:
        ideen = db.get(Space, world["ideen"])
        assert ideen is not None and ideen.external_id
        ideen.deleted_at = utcnow() - timedelta(days=40)
        local = Space(name="Alt", deleted_at=utcnow() - timedelta(days=40))
        db.add(local)
        db.commit()
        local_id = local.id
    cleanup.run_once()
    with SessionLocal() as db:
        assert db.get(Space, world["ideen"]) is not None, "nexsuite says when it is gone"
        assert db.get(Space, local_id) is None


def test_d6_a_blocked_person_is_no_colleague_to_pick(client: TestClient, operator: Account) -> None:
    gone = make_account("gone")
    make_account("mia")
    with SessionLocal() as db:
        db.get(Account, gone.id).blocked_at = utcnow()  # type: ignore[union-attr]
        db.commit()
    with new_client() as mia:
        sign_in(mia, Account(id=_id("mia"), name="mia"))
        assert "gone" not in [p["name"] for p in mia.get("/api/directory").json()["people"]]
    seen = {p["name"]: p for p in client.get("/api/directory").json()["people"]}
    assert seen["gone"]["blocked"] is True, "the operator still sees it, marked"


def test_f5_the_operator_blocks_an_account_alone_too(client: TestClient, operator: Account, space: int) -> None:
    rita = make_account("rita")
    assert client.post(f"/api/accounts/{rita.id}/block", json={"current_password": "wrong"}).status_code == 401
    assert client.post(f"/api/accounts/{operator.id}/block", json={"current_password": PASSWORD}).status_code == 409
    assert client.post(f"/api/accounts/{rita.id}/block", json={"current_password": PASSWORD}).status_code == 204
    with new_client() as stranger:
        assert stranger.post("/api/auth/login", json={"name": "rita", "password": PASSWORD}).status_code == 401
    assert client.post(f"/api/accounts/{rita.id}/unblock", json={"current_password": PASSWORD}).status_code == 204
    with SessionLocal() as db:
        assert db.get(Account, rita.id).blocked_at is None  # type: ignore[union-attr]


def test_a11_the_plain_way_needs_nexsuite_and_the_emergency_report_waits_for_it(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    fake.emergency = [hashlib.sha256(b"WXYZ23456789").hexdigest()]
    connect(client, world, operator)
    fake.down = True
    refused = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "suite_unreachable_disconnect"
    with SessionLocal() as db:
        assert settings_service.get(db, "suite_state") == "connected"
    right = client.post("/api/suite/emergency", json={"current_password": PASSWORD, "code": "WXYZ-2345-6789"})
    assert right.status_code == 200, right.text
    assert fake.reports == []
    fake.down = False
    suite.run_forever_sync()  # the round of the background loop, connected or not
    with SessionLocal() as db:
        assert settings_service.get(db, "suite_owed") is None
    assert fake.reports == [{"kind": "emergency_disconnect", "who": "tester"}], "told once nexsuite is back"


class AtOnce:
    """A thread that runs at once, so a test sees what it did."""

    def __init__(self, target: Any = None, **_: Any) -> None:
        self.target = target

    def start(self) -> None:
        self.target()


def test_a11_an_emergency_sign_in_is_reported(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite, monkeypatch: Any
) -> None:
    import threading

    connect(client, world, operator)
    monkeypatch.setattr(threading, "Thread", AtOnce)
    with new_client() as browser:
        assert browser.post("/api/auth/login", json={"name": "tester", "password": PASSWORD}).status_code == 200
    assert fake.reports == [{"kind": "emergency_sign_in", "who": "tester"}]


def test_a11_the_emergency_sign_in_counts_after_the_second_factor(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite, clock: Any, monkeypatch: Any
) -> None:
    import threading

    secret, _codes = test_totp.enrol(client)
    connect(client, world, operator)
    monkeypatch.setattr(threading, "Thread", AtOnce)
    with new_client() as browser:
        test_totp.password_step(browser)
        assert fake.reports == [], "the password alone is no sign-in yet"
        assert test_totp.code_step(browser, test_totp.fresh_code(secret, clock)).status_code == 200
    assert fake.reports == [{"kind": "emergency_sign_in", "who": "tester"}]


def test_b7_a_matched_address_goes_along_and_a_personal_space_stays_here(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    with SessionLocal() as db:
        erik = db.query(Account).filter_by(name="erik").one()
        erik.email = "erik@example.com"
        db.commit()
    own = client.post("/api/spaces", json={"name": "Mine"}).json()["id"]
    found = connect(client, world, operator)
    assert {s["id"]: s["suggest"] for s in found["spaces"]}[own] == "keep", "one person, no team: stays here"
    assert fake.people["3"]["email"] == "erik@example.com", "matched by name, the address from here goes along"
    assert fake.people["2"]["email"] == "anna@example.com"
    with SessionLocal() as db:
        mine = db.get(Space, own)
        assert mine is not None and mine.external_id == "" and mine.deleted_at is None
    assert "Mine" not in [s["name"] for s in fake.spaces.values()]
    with SessionLocal() as db:
        assert db.query(Account).filter_by(name="erik").one().email == "erik@example.com"

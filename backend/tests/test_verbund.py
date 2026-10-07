"""Connecting to nexsuite, connecting again, signing in through it: what the check of 05.10.2026 found in nextasks and
nexbrand (the numbers are those of nexsuite/tools/pruefgang-2026-10-05/LISTE.md), each as it should be here too, and
#job-172 (a left-out account never takes over a person). nexsuite is played by ``FakeSuite`` from ``test_suite``."""

from __future__ import annotations

import ast
import hashlib
import hmac
import json
import pathlib
import re
import threading
import time
import types
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import OPERATOR, Account, Board, Space, SpaceNotice, Team, utcnow
from app.services import logs, settings_service, suite

from . import test_oidc, test_suite
from .conftest import PASSWORD, make_account, new_client
from .test_suite import SUITE, FakeSuite, connect

# The fixtures of the suite and OIDC tests, under the names pytest looks for.
fake = test_suite.fake
world = test_suite.world
provider = test_oidc.provider


def _row(name: str) -> Account:
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name=name).one()
        db.expunge(row)
    return row


def _setting(key: str) -> Any:
    with SessionLocal() as db:
        return settings_service.get(db, key)


def _code(answer: Any) -> str:
    return str(answer.json()["detail"]["code"])


def _disconnect(client: TestClient, fake: FakeSuite) -> None:
    gone = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
    assert gone.status_code == 200, gone.text
    fake.connected = False


def _again(client: TestClient) -> dict[str, Any]:
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"})
    assert found.status_code == 200, found.text
    return {a["name"]: a for a in found.json()["accounts"]}


# --- B2 -------------------------------------------------------------------------------------------------------------


def test_b2_abort_gives_up_only_a_connection_that_did_not_finish(client: TestClient, operator: Account, world: dict,
                                                                  fake: FakeSuite) -> None:
    connect(client, world, operator)
    answer = client.post("/api/suite/abort")
    assert answer.status_code == 409 and _code(answer) == "already_connected"
    assert _setting("suite_state") == "connected" and _setting("suite_url") == SUITE
    assert ("POST", "/leave") not in fake.calls, "nexsuite is not told to forget the app"
    refused = client.post("/api/teams", json={"name": "Again"})
    assert refused.status_code == 409 and _code(refused) == "managed_by_suite"


# --- B9 -------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("what", "choice"), [("accounts", "99999"), ("accounts", "blocked"), ("spaces", "77777"),
                                               ("teams", "88888")])
def test_b9_a_choice_nexsuite_does_not_know_is_refused_before_anything_is_made(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, what: str, choice: str) -> None:
    fake.people["9"] = {"id": "9", "name": "zoe", "display_name": "Zoe", "email": "", "operator": False,
                        "blocked": True}
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    chosen = {
        "accounts": {a["id"]: a["suggest"] for a in found["accounts"]},
        "spaces": {s["id"]: s["suggest"] for s in found["spaces"]},
        "teams": {t["id"]: t["suggest"] for t in found["teams"]},
    }
    target = {"accounts": world["anna"].id, "spaces": world["studio"], "teams": world["team"]}[what]
    chosen[what][target] = "9" if choice == "blocked" else choice
    answer = client.post("/api/suite/finish", json=chosen)
    expected = {"accounts": "person_unknown", "spaces": "space_unknown", "teams": "team_unknown"}[what]
    assert answer.status_code == 409 and _code(answer) == expected, answer.text
    assert _setting("suite_state") == "connecting"
    made = [call for call in fake.calls if call[0] == "POST" and call[1] in ("/people", "/teams", "/spaces")]
    assert made == [], "nothing is made in nexsuite"
    assert _row("anna").blocked_at is None and _row("anna").oidc_subject == ""


# --- B8 -------------------------------------------------------------------------------------------------------------


def test_b8_a_left_out_account_stays_blocked_when_connecting_again(client: TestClient, operator: Account,
                                                                    world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    assert _row("cleo").blocked_at is not None
    _disconnect(client, fake)
    rows = _again(client)
    assert rows["cleo"]["suggest"] == "skip" and rows["cleo"]["blocked"] is True
    assert rows["anna"]["suggest"] == "2" and rows["anna"]["from_suite"] is True and rows["anna"]["blocked"] is False
    choices = {a["id"]: a["suggest"] for a in client.get("/api/suite/proposal").json()["accounts"]}
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    assert _row("cleo").blocked_at is not None, "nobody let it in on a suggestion"
    assert not [p for p in fake.people.values() if p["name"] == "cleo"]


def test_b8_a_person_deleted_in_nexsuite_is_not_brought_back(client: TestClient, operator: Account, world: dict,
                                                              fake: FakeSuite) -> None:
    connect(client, world, operator)
    ben = _row("ben").oidc_subject
    del fake.people[ben]
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("ben").blocked_at is not None
    _disconnect(client, fake)
    rows = _again(client)
    assert rows["ben"]["suggest"] == "skip" and rows["ben"]["gone"] is True and rows["ben"]["blocked"] is True
    choices = {a["id"]: a["suggest"] for a in client.get("/api/suite/proposal").json()["accounts"]}
    before = len(fake.people)
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    assert len(fake.people) == before, "no new person, no mail to set a password"


def test_b8_an_account_nexsuite_brought_gets_its_own_person_again(client: TestClient, operator: Account,
                                                                   world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    # Another app made a person "cleo" in nexsuite; the sync brings it here next to the left-out cleo.
    fake.people["60"] = {"id": "60", "name": "cleo", "display_name": "Cleo", "email": "", "operator": False,
                         "blocked": False}
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("cleo2").oidc_subject == "60"
    _disconnect(client, fake)
    rows = _again(client)
    assert rows["cleo2"]["suggest"] == "60" and rows["cleo2"]["from_suite"] is True
    assert rows["cleo"]["suggest"] == "skip", "the left-out one does not take the person by its name"
    choices = {a["id"]: a["suggest"] for a in client.get("/api/suite/proposal").json()["accounts"]}
    before = len(fake.people)
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    assert len(fake.people) == before, "no second cleo in nexsuite"
    assert _row("cleo2").oidc_subject == "60"


def test_b8_an_account_linked_to_authentik_and_left_out_is_no_person_nexsuite_knew(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    with SessionLocal() as db:  # cleo signed in through authentik before connecting
        cleo = db.get(Account, world["cleo"].id)
        assert cleo is not None
        cleo.oidc_subject = "authentik-hash-of-cleo"
        db.commit()
    connect(client, world, operator)
    assert _row("cleo").suite_person == "" and _row("cleo").oidc_subject == ""
    assert _row("cleo").oidc_subject_local == "authentik-hash-of-cleo", "its own link waits apart"
    fake.people["61"] = {"id": "61", "name": "cleo", "display_name": "Cleo", "email": "", "operator": False,
                         "blocked": False}
    client.post("/api/suite/sync")
    assert _row("cleo2").oidc_subject == "61", "the left-out account keeps its name"
    _disconnect(client, fake)
    assert _row("cleo").oidc_subject == "authentik-hash-of-cleo", "its own link stays on disconnecting"
    rows = _again(client)
    assert rows["cleo"]["from_suite"] is False and rows["cleo"]["gone"] is False


def test_b21_a_connection_from_before_renames_only_accounts_nexsuite_knew(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """Connected under bf64550: nothing kept ``suite_person``, and cleo, left out, kept its authentik link. A new
    person "cleo" in nexsuite does not rename it, and after a disconnect it is no account that came from nexsuite."""
    with SessionLocal() as db:
        cleo = db.get(Account, world["cleo"].id)
        assert cleo is not None
        cleo.oidc_subject = "authentik-hash-of-cleo"
        db.commit()
    connect(client, world, operator)
    with SessionLocal() as db:  # as the commit before left it
        for row in db.query(Account):
            row.suite_person = ""
        db.get(Account, world["cleo"].id).oidc_subject = "authentik-hash-of-cleo"  # type: ignore[union-attr]
        db.commit()
    fake.people["62"] = {"id": "62", "name": "cleo", "display_name": "Cleo", "email": "", "operator": False,
                         "blocked": False}
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("cleo").id == world["cleo"].id, "the left-out account keeps its name"
    assert _row("cleo2").oidc_subject == "62"
    _disconnect(client, fake)
    assert _row("cleo").oidc_subject == "authentik-hash-of-cleo"
    rows = _again(client)
    assert rows["cleo"]["from_suite"] is False and rows["cleo"]["gone"] is False
    assert rows["anna"]["from_suite"] is True and rows["anna"]["suggest"] == "2", "nexsuite's own accounts still are"


def test_b21_a_connection_from_before_learns_its_people_with_the_next_sync(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    with SessionLocal() as db:  # as the commit before left it
        for row in db.query(Account):
            row.suite_person = ""
        db.commit()
    client.post("/api/suite/sync")
    assert _row("anna").suite_person == "2", "the directory says which accounts are nexsuite's"
    old = _row("anna")
    del fake.people["2"]
    client.post("/api/suite/sync")
    fake.people["82"] = {"id": "82", "name": "anna", "display_name": "Anna Neu", "email": "", "operator": False,
                         "blocked": False}
    client.post("/api/suite/sync")
    assert _row("anna").oidc_subject == "82" and _row("anna2").id == old.id


def test_b21_a_connection_from_before_without_a_sync_lets_go_of_the_unblocked_only(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    with SessionLocal() as db:
        db.get(Account, world["cleo"].id).oidc_subject = "authentik-hash-of-cleo"  # type: ignore[union-attr]
        db.commit()
    connect(client, world, operator)
    with SessionLocal() as db:
        for row in db.query(Account):
            row.suite_person = ""
        db.commit()
    _disconnect(client, fake)
    assert _row("anna").oidc_subject == "" and _row("anna").suite_person == "2"
    assert _row("cleo").oidc_subject == "authentik-hash-of-cleo" and _row("cleo").suite_person == ""


def _signs_in_as(client: TestClient, provider: Any, subject: str) -> str:
    browser = test_oidc.fresh_browser(client)
    landed = _sign_in_from(browser, provider, "/", sub=subject, email="someone@example.com")
    assert landed.status_code == 303, landed.text
    me = browser.get("/api/auth/me")
    return me.json()["name"] if me.status_code == 200 else landed.headers["location"]


def test_collision_a_left_out_link_that_looks_like_a_person_is_not_that_person(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    """(A) cleo signed in through Forgejo as "3" before connecting and is left out; person 3 in nexsuite is erik."""
    with SessionLocal() as db:
        db.get(Account, world["cleo"].id).oidc_subject = "3"  # type: ignore[union-attr]
        db.commit()
    connect(client, world, operator)
    _provider_is_nexsuite()
    assert _row("cleo").oidc_subject == "" and _row("cleo").oidc_subject_local == "3"
    assert _signs_in_as(client, provider, "3") == "erik"
    with SessionLocal() as db:  # connected under an earlier commit: cleo kept "3", nothing marked, no sync since
        for row in db.query(Account):
            row.suite_person = ""
        db.get(Account, world["cleo"].id).oidc_subject = "3"  # type: ignore[union-attr]
        db.commit()
    assert _signs_in_as(client, provider, "3") == "erik", "the account nexsuite knows, not the older look-alike"
    client.post("/api/suite/sync")
    _disconnect(client, fake)
    assert _row("cleo").oidc_subject == "3" and _row("cleo").oidc_subject_local == "", "its own link comes back"
    assert _row("erik").oidc_subject == ""


def test_collision_finishing_puts_a_link_of_its_own_apart_at_once(client: TestClient, operator: Account,
                                                                    world: dict, fake: FakeSuite,
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    """Not left for the next sync to sort out: finishing itself takes cleo's "3" out of ``oidc_subject``."""
    with SessionLocal() as db:
        db.get(Account, world["cleo"].id).oidc_subject = "3"  # type: ignore[union-attr]
        db.commit()
    monkeypatch.setattr(suite, "sync", lambda _db: False)
    connect(client, world, operator)
    assert _row("cleo").oidc_subject == "" and _row("cleo").oidc_subject_local == "3"
    assert _row("erik").oidc_subject == "3" and _row("erik").suite_person == "3"


def test_collision_a_left_out_account_never_takes_over_a_person(client: TestClient, operator: Account, world: dict,
                                                               fake: FakeSuite) -> None:
    """(B) zoe signed in through another provider as "2" and is left out; person 2 is anna."""
    zoe = make_account("zoe")
    with SessionLocal() as db:
        row = db.get(Account, zoe.id)
        assert row is not None
        row.oidc_subject, row.email, row.display_name = "2", "zoe@example.com", "Zoe"
        db.commit()
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[zoe.id] = choices[world["cleo"].id] = "skip"
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    client.post("/api/suite/sync")
    after = _row("zoe")
    assert after.blocked_at is not None and after.email == "zoe@example.com" and after.display_name == "Zoe"
    assert after.suite_person == "" and after.oidc_subject == ""
    assert _row("anna").oidc_subject == "2" and _row("anna").blocked_at is None


def test_collision_a_connection_from_before_settles_who_claims_a_person(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    """Connected under an earlier commit, the left-out zoe kept "2" beside anna, nothing marked. Before the next sync
    a sign-in as 2 is anna's; the sync keeps zoe apart; a person blocked in nexsuite keeps its account."""
    zoe = make_account("zoe")
    connect(client, world, operator)
    _provider_is_nexsuite()
    fake.people["3"]["blocked"] = True
    client.post("/api/suite/sync")
    with SessionLocal() as db:  # as the commit before left it
        for row in db.query(Account):
            row.suite_person = ""
        moved = db.get(Account, zoe.id)
        assert moved is not None
        moved.oidc_subject, moved.blocked_at, moved.email = "2", moved.blocked_at or utcnow(), "zoe@example.com"
        db.commit()
    assert _signs_in_as(client, provider, "2") == "anna"
    client.post("/api/suite/sync")
    assert _row("zoe").oidc_subject == "" and _row("zoe").oidc_subject_local == "2"
    assert _row("zoe").blocked_at is not None and _row("zoe").email == "zoe@example.com"
    assert _row("anna").suite_person == "2"
    assert _row("erik").oidc_subject == "3" and _row("erik").suite_person == "3", "blocked there, still its own"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.name.like("erik%")).count() == 1


def _legacy(subjects: dict[str, str], mark: bool = False, **changes: Any) -> None:
    """As an earlier commit left the accounts: ``suite_person`` empty (or, ``mark``, equal to the subject)."""
    with SessionLocal() as db:
        for row in db.query(Account):
            row.suite_person = ""
        for name, subject in subjects.items():
            row = db.query(Account).filter_by(name=name).one()
            row.oidc_subject = subject
            row.suite_person = subject if mark else ""
            for key, value in changes.get(name, {}).items():
                setattr(row, key, value)
        db.commit()


def test_linking_is_refused_while_connected(client: TestClient, operator: Account, world: dict, fake: FakeSuite,
                                            provider: Any) -> None:
    """The emergency account signs in with a password and could link itself to "999": refused on both legs."""
    test_oidc.configure(client, auto_create=False)
    started = client.post("/api/oidc/link/start", json={"password": PASSWORD})
    assert started.status_code == 200, started.text
    values = {k: v[0] for k, v in parse_qs(urlsplit(started.json()["url"]).query).items()}
    connect(client, world, operator)
    _provider_is_nexsuite()
    again = client.post("/api/oidc/link/start", json={"password": PASSWORD})
    assert again.status_code == 409 and _code(again) == "managed_by_suite"
    provider.challenge = values["code_challenge"]
    provider.claims = {"nonce": values["nonce"], "sub": "999"}
    back = test_oidc.come_back(client, values["state"])
    assert back.headers["location"] == "/account?error=managed_by_suite"
    assert _row("tester").oidc_subject == "1"


def test_a_link_made_while_connected_never_claims_a_person(client: TestClient, operator: Account, world: dict,
                                                           fake: FakeSuite) -> None:
    """Under bf64550 the emergency account (person 1) could link itself to "999"; a person 999 made in nexsuite
    then must neither get that account nor push it out of its own person."""
    connect(client, world, operator)
    with SessionLocal() as db:
        db.get(Account, operator.id).oidc_subject = "999"  # type: ignore[union-attr]
        db.commit()
    fake.people["999"] = {"id": "999", "name": "neu", "display_name": "Neu", "email": "", "operator": False,
                          "blocked": False}
    assert client.post("/api/suite/sync").status_code == 200
    keeper = _row("tester")
    assert (keeper.oidc_subject, keeper.suite_person, keeper.oidc_subject_local) == ("1", "1", ""), \
        "a subject that came while connected is dropped, never handed back on disconnecting"
    assert keeper.blocked_at is None
    assert _row("neu").oidc_subject == "999"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.name.like("tester%")).count() == 1


@pytest.mark.parametrize("mark", [False, True], ids=["bf64550", "marked"])
def test_settled_an_account_without_a_person_is_blocked_and_gives_back_what_it_took(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, mark: bool) -> None:
    """An earlier commit handed the left-out cleo anna's person: same subject, anna's address and name, unblocked.
    Settled, anna keeps the person; cleo is blocked and loses address and name it never had."""
    connect(client, world, operator)
    _legacy({"anna": "2", "cleo": "2"}, mark,
            cleo={"email": "anna@example.com", "display_name": "Anna Berg", "blocked_at": None})
    assert client.post("/api/suite/sync").status_code == 200
    cleo, anna = _row("cleo"), _row("anna")
    assert anna.oidc_subject == "2" and anna.suite_person == "2" and anna.blocked_at is None
    assert (cleo.oidc_subject, cleo.suite_person, cleo.oidc_subject_local) == ("", "", "2")
    assert cleo.blocked_at is not None and cleo.email == "" and cleo.display_name == ""


@pytest.mark.parametrize("renamed", [False, True], ids=["as copied", "display name changed in nexsuite since"])
@pytest.mark.parametrize("mark", [False, True], ids=["bf64550", "marked"])
def test_settled_the_sign_in_name_decides_not_what_an_old_sync_copied(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any, mark: bool,
        renamed: bool) -> None:
    """An earlier sync copied erik's address and display name onto cleo, who was left out with a link "3" of its
    own, older than erik's account; erik's own account has no address. The sign-in name decides: erik keeps the
    person, also when nexsuite changed the display name since; cleo is blocked and loses what was copied, as far as
    it is still exactly the person's."""
    connect(client, world, operator)
    _provider_is_nexsuite()
    fake.people["3"]["email"] = "erik@example.com"
    _legacy({"cleo": "3", "erik": "3"}, mark,
            cleo={"email": "erik@example.com", "display_name": "Erik", "blocked_at": None},
            erik={"email": "", "display_name": "Erik"})
    if renamed:
        fake.people["3"]["display_name"] = "Erik Neu"
    assert client.post("/api/suite/sync").status_code == 200
    erik, cleo = _row("erik"), _row("cleo")
    assert (erik.oidc_subject, erik.suite_person, erik.blocked_at) == ("3", "3", None)
    assert (cleo.oidc_subject, cleo.suite_person, cleo.oidc_subject_local) == ("", "", "3")
    assert cleo.blocked_at is not None
    copied = ("erik@example.com", "Erik") if renamed else ("", "")
    assert (cleo.email, cleo.display_name) == copied
    assert _signs_in_as(client, provider, "3") == "erik"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.name.like("erik%")).count() == 1


@pytest.mark.parametrize(("anna", "owner"), [
    ({"blocked_at": utcnow()}, "cleo"),  # neither has the sign-in name: the unblocked one over the blocked older one
    ({}, "anna"),  # neither has it, both unblocked: the oldest
], ids=["unblocked next", "oldest last"])
def test_settled_without_the_name_the_unblocked_then_the_oldest(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, anna: dict, owner: str) -> None:
    connect(client, world, operator)
    fake.people["2"]["name"] = "anna.berg"  # renamed in nexsuite: no account here carries it
    _legacy({"anna": "2", "cleo": "2"}, mark=True, anna=anna, cleo={"blocked_at": None})
    client.post("/api/suite/sync")
    other = "anna" if owner == "cleo" else "cleo"
    assert _row(owner).oidc_subject == "2" and _row(other).oidc_subject_local == "2"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.oidc_subject == "2").count() == 1


def test_settled_a_person_blocked_there_and_renamed_since_keeps_its_account(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """Connected under an earlier commit, erik blocked in nexsuite; nexsuite changed the display name since. The
    sign-in name still says it is erik's account: no erik2."""
    connect(client, world, operator)
    fake.people["3"]["blocked"] = True
    client.post("/api/suite/sync")
    _legacy({"erik": "3"})
    fake.people["3"]["display_name"] = "Erik Neu"
    client.post("/api/suite/sync")
    erik = _row("erik")
    assert (erik.oidc_subject, erik.suite_person, erik.display_name) == ("3", "3", "Erik Neu")
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.name.like("erik%")).count() == 1


def test_settled_the_choice_when_connecting_comes_before_the_sign_in_name(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    """The operator gave person 2 ("anna") to ben and left the account anna out; anna kept a subject "2" of a general
    provider from a connection made before ``oidc_subject_local`` existed. The choice wins: ben keeps the person and
    stays in, anna is set apart and stays blocked. Before, anna won by her name and ben was blocked."""
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[world["ben"].id], choices[world["anna"].id], choices[world["cleo"].id] = "2", "skip", "skip"
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    assert _row("ben").suite_person == "2" and _row("anna").blocked_at is not None
    _provider_is_nexsuite()
    with SessionLocal() as db:  # as a connection from before left it
        anna = db.query(Account).filter_by(name="anna").one()
        anna.oidc_subject, anna.suite_person, anna.oidc_subject_local = "2", "", ""
        db.commit()
    assert client.post("/api/suite/sync").status_code == 200
    ben, anna = _row("ben"), _row("anna")
    assert (ben.oidc_subject, ben.suite_person, ben.blocked_at) == ("2", "2", None)
    assert (anna.oidc_subject, anna.suite_person, anna.oidc_subject_local) == ("", "", "2")
    assert anna.blocked_at is not None
    assert _signs_in_as(client, provider, "2") == "ben"


def test_settled_unmarked_the_sign_in_name_wins_over_blocked_and_a_larger_id(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """Nobody marked: the account named like the person wins although it is blocked and younger than the other."""
    connect(client, world, operator)
    fake.people["2"]["name"] = "zoe"
    zoe = make_account("zoe")
    assert zoe.id > world["cleo"].id
    _legacy({"anna": "", "cleo": "2", "zoe": "2"}, cleo={"blocked_at": None}, zoe={"blocked_at": utcnow()})
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("zoe").oidc_subject == "2" and _row("zoe").suite_person == "2"
    assert _row("cleo").oidc_subject == "" and _row("cleo").oidc_subject_local == "2"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.oidc_subject == "2").count() == 1


def test_settled_a_shared_mailbox_is_not_taken_from_a_left_out_account(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """cleo, left out, signs in through authentik and shares anna's mailbox: set apart, it keeps its address."""
    connect(client, world, operator)
    _legacy({"cleo": "authentik-hash-of-cleo"}, cleo={"email": "anna@example.com", "display_name": "Cleo"})
    client.post("/api/suite/sync")
    cleo = _row("cleo")
    assert cleo.oidc_subject_local == "authentik-hash-of-cleo" and cleo.email == "anna@example.com"
    assert cleo.display_name == "Cleo" and cleo.blocked_at is not None


def test_b8_an_earlier_person_counts_only_for_the_same_nexsuite(client: TestClient, operator: Account, world: dict,
                                                                  fake: FakeSuite) -> None:
    connect(client, world, operator)
    _disconnect(client, fake)
    with SessionLocal() as db:
        settings_service.save(db, {"suite_former_url": "https://other.example.com"})
        db.commit()
    rows = _again(client)
    assert all(row["from_suite"] is False for row in rows.values())


# --- B23 ------------------------------------------------------------------------------------------------------------


def test_b23_the_choices_are_kept_while_connecting(client: TestClient, operator: Account, world: dict,
                                                   fake: FakeSuite) -> None:
    client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"})
    kept = {"accounts": {str(world["cleo"].id): "skip"}, "spaces": {str(world["studio"]): "keep"}, "teams": {},
            "step": 3}
    assert client.put("/api/suite/choices", json=kept).status_code == 204
    assert client.get("/api/suite/proposal").json()["chosen"] == kept
    with new_client(world["anna"]) as anna:
        assert anna.put("/api/suite/choices", json=kept).status_code == 403
    assert client.post("/api/suite/abort").status_code == 204
    late = client.put("/api/suite/choices", json=kept)
    assert late.status_code == 409 and _code(late) == "not_connecting"
    assert _setting("suite_pending") is None


class _Arrival:
    """The connect lock, telling when somebody arrives at it."""

    def __init__(self, lock: Any) -> None:
        self.lock, self.arrived = lock, threading.Event()

    def __enter__(self) -> None:
        self.arrived.set()
        self.lock.acquire()

    def __exit__(self, *_exc: object) -> None:
        self.lock.release()


def test_b23_a_late_save_never_brings_back_what_finishing_cleared(client: TestClient, operator: Account,
                                                                  world: dict, fake: FakeSuite,
                                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    """Checked and written under the lock a finish holds: a save that arrives while finishing runs waits, then finds
    the connection done and writes nothing (without the lock it would put the pending secrets back)."""
    client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"})
    real = suite._connect_lock
    door = _Arrival(real)
    monkeypatch.setattr(suite, "_connect_lock", door)
    outcome: list[str] = []

    def save() -> None:
        with SessionLocal() as db:
            try:
                suite.keep_choices(db, {"accounts": {}, "spaces": {}, "teams": {}, "step": 2})
                outcome.append("written")
            except suite.SuiteError as exc:
                outcome.append(exc.code)

    with real:
        late = threading.Thread(target=save)
        late.start()
        assert door.arrived.wait(10), "the save goes through the lock"
        with SessionLocal() as db:  # what a finish ends with, while the save waits
            settings_service.save(db, {"suite_state": "connected", "suite_pending": None})
            db.commit()
    late.join(10)
    assert outcome == ["not_connecting"]
    assert _setting("suite_pending") is None


# --- B24 ------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("refusal", "expected"), [("client_required", "not_suite"), ("suite_failed", "not_suite"),
                                                    ("not_found", "not_suite"), ("pair_code_invalid",
                                                                                 "pair_code_invalid"),
                                                    ("suite_unreachable", "suite_unreachable")])
def test_b24_another_app_or_a_path_is_named_as_the_wrong_address(client: TestClient, operator: Account,
                                                                  fake: FakeSuite, monkeypatch: pytest.MonkeyPatch,
                                                                  refusal: str, expected: str) -> None:
    def other(method: str, url: str, **_kwargs: Any) -> Any:
        raise suite.SuiteError(refusal, "refused", 409)

    monkeypatch.setattr(suite, "request", other)
    answer = client.post("/api/suite/start", json={"url": SUITE + "/foo", "code": "GOOD-CODE-1234"})
    assert answer.status_code in (409, 502) and _code(answer) == expected
    assert _setting("suite_state") == ""


def test_b24_a_short_code_or_one_nexsuite_cannot_read_is_a_wrong_code(client: TestClient, operator: Account,
                                                                       fake: FakeSuite,
                                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    short = client.post("/api/suite/start", json={"url": SUITE, "code": "  ab    "})
    assert short.status_code == 409 and _code(short) == "pair_code_invalid"
    assert ("POST", "/pair") not in fake.calls

    def unreadable(method: str, url: str, **_kwargs: Any) -> Any:
        raise suite.SuiteError("suite_failed", "nexsuite refused.", 409, 422)

    monkeypatch.setattr(suite, "request", unreadable)
    answer = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234-TOO-LONG"})
    assert answer.status_code == 409 and _code(answer) == "pair_code_invalid"
    assert _setting("suite_state") == ""


def test_b24_an_answer_that_is_not_a_pairing_is_not_nexsuite(client: TestClient, operator: Account, fake: FakeSuite,
                                                              monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(suite, "request", lambda *_args, **_kwargs: {"status": "ok"})
    answer = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"})
    assert answer.status_code == 409 and _code(answer) == "not_suite"
    assert _setting("suite_state") == ""


# --- B21 ------------------------------------------------------------------------------------------------------------


def test_b21_a_new_person_takes_the_name_of_a_deleted_one(client: TestClient, operator: Account, world: dict,
                                                          fake: FakeSuite) -> None:
    connect(client, world, operator)
    old = _row("anna")
    with SessionLocal() as db:  # what still names the account by its name: notices it caused and was the subject of
        db.add(SpaceNotice(account_id=operator.id, space_id=world["studio"], space_name="Studio", kind="operator_role",
                           actor="anna", actor_id=old.id, subject="anna"))
        db.commit()
    with open(logs.log_file(), "a", encoding="utf-8") as log:
        log.write("2026-10-05 10:00:00 INFO     nexcanvas.boards [abc u:anna] | Board made by=anna id=4\n")
        log.write("2026-10-05 10:00:01 INFO     nexcanvas.suite [-] | Sessions ended as in nexsuite name=anna count=1\n")
    del fake.people["2"]
    client.post("/api/suite/sync")
    fake.people["80"] = {"id": "80", "name": "anna", "display_name": "Anna Neu", "email": "", "operator": False,
                         "blocked": False}
    client.post("/api/suite/sync")
    assert _row("anna").oidc_subject == "80", "the name is as in nexsuite"
    with SessionLocal() as db:
        moved = db.get(Account, old.id)
        assert moved is not None and moved.name == "anna2" and moved.blocked_at is not None
        notice = db.query(SpaceNotice).filter_by(actor_id=old.id).one()
        assert (notice.actor, notice.subject) == ("anna2", "anna2")
    text = logs.log_file().read_text(encoding="utf-8")
    assert "[abc u:anna2] | Board made by=anna2 id=4" in text and "u:anna]" not in text
    assert "name=anna2 count=1" in text and "name=anna " not in text
    # The emergency account keeps its name whatever nexsuite does: it is its way in.
    with SessionLocal() as db:
        keeper = db.get(Account, operator.id)
        assert keeper is not None and keeper.name == "tester"
    del fake.people["1"]
    fake.people["81"] = {"id": "81", "name": "tester", "display_name": "", "email": "", "operator": False,
                         "blocked": False}
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        keeper = db.get(Account, operator.id)
        assert keeper is not None and keeper.name == "tester"


# --- B20 ------------------------------------------------------------------------------------------------------------


def _provider_is_nexsuite() -> None:
    """Connected, nexsuite is the provider: here the fake provider of the OIDC tests stands in for it."""
    from app.security import encrypt_secret

    with SessionLocal() as db:
        settings_service.save(db, {"oidc_issuer": test_oidc.ISSUER, "oidc_client_id": test_oidc.CLIENT_ID,
                                   "oidc_client_secret_enc": encrypt_secret(test_oidc.CLIENT_SECRET)})
        db.commit()


def test_b20_a_person_made_a_moment_ago_gets_in_at_once(client: TestClient, operator: Account, world: dict,
                                                        fake: FakeSuite, provider: Any) -> None:
    connect(client, world, operator)
    _provider_is_nexsuite()
    fake.people["90"] = {"id": "90", "name": "neu", "display_name": "Neu", "email": "neu@example.com",
                         "operator": False, "blocked": False}
    browser = test_oidc.fresh_browser(client)
    landed = _sign_in_from(browser, provider, "/b/12", sub="90", email="neu@example.com")
    assert landed.status_code == 303 and landed.headers["location"] == "/b/12", landed.headers["location"]
    assert browser.get("/api/auth/me").json()["name"] == "neu"


def test_b20_somebody_nexsuite_does_not_give_fetches_once_and_is_told_to_wait(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    connect(client, world, operator)
    _provider_is_nexsuite()
    suite._unknown_tried.clear()
    fetches = sum(1 for call in fake.calls if call == ("GET", "/directory"))
    for _round in range(3):
        browser = test_oidc.fresh_browser(client)
        landed = _sign_in_from(browser, provider, "/", sub="91", email="anna@example.com")
        assert landed.headers["location"] == "/login?error=suite_no_account", "no bridge by address while connected"
    assert sum(1 for call in fake.calls if call == ("GET", "/directory")) == fetches + 1, "one fetch per person"
    assert _row("anna").oidc_subject == "2"


# --- B26 ------------------------------------------------------------------------------------------------------------


def test_b26_an_invitation_from_before_says_at_once_that_it_holds_no_more(client: TestClient, operator: Account,
                                                                          world: dict, fake: FakeSuite) -> None:
    link = client.post(f"/api/spaces/{world['studio']}/invites", json={"role": "write", "days": 7}).json()["link"]
    token = link.rsplit("/", 1)[1]
    assert client.get(f"/api/invite/{token}").status_code == 200
    connect(client, world, operator)
    answer = client.get(f"/api/invite/{token}")
    assert answer.status_code == 404 and _code(answer) == "invite_suite"
    assert "Studio" not in answer.text


# --- G3 -------------------------------------------------------------------------------------------------------------


def test_g3_everybody_connected_learns_where_nexsuite_opens(client: TestClient, operator: Account, world: dict,
                                                            fake: FakeSuite) -> None:
    with new_client(world["anna"]) as anna:
        assert anna.get("/api/auth/me").json()["suite_url"] == ""
    connect(client, world, operator)
    with new_client(world["anna"]) as anna:
        assert anna.get("/api/auth/me").json()["suite_url"] == SUITE


# --- B10 ------------------------------------------------------------------------------------------------------------


def _sign_in_from(browser: TestClient, fake_provider: Any, path: str, **claims: Any) -> Any:
    started = browser.get("/api/oidc/start", params={"next": path}, follow_redirects=False)
    assert started.status_code == 302, started.text
    values = {k: v[0] for k, v in parse_qs(urlsplit(started.headers["location"]).query).items()}
    fake_provider.challenge = values["code_challenge"]
    fake_provider.claims = {"nonce": values["nonce"], **claims}
    return test_oidc.come_back(browser, values["state"])


def test_b10_a_direct_link_survives_the_sign_in(client: TestClient, operator: Account, provider: Any) -> None:
    test_oidc.configure(client)
    browser = test_oidc.fresh_browser(client)
    landed = _sign_in_from(browser, provider, "/b/5?item=3")
    assert landed.status_code == 303 and landed.headers["location"] == "/b/5?item=3"


@pytest.mark.parametrize("path", ["//evil.example.com/x", "/\\evil.example.com", "https://evil.example.com/",
                                  "/api/auth/logout", "/api", "javascript:alert(1)", "/b/1\nSet-Cookie: x=1",
                                  "/", "/%61pi/auth/logout", "/API/auth/logout", "/%2561pi/x", "/%2F%2Fevil.example.com",
                                  "/b/" + "x" * 600, "/./api/auth/me", "/x/%2e%2e/api/suite", "/c/../api",
                                  "/x/%252e%252e/API/suite"])
def test_b10_only_a_page_of_nexcanvas_own_is_a_landing(client: TestClient, operator: Account, provider: Any,
                                                       path: str) -> None:
    test_oidc.configure(client)
    browser = test_oidc.fresh_browser(client)
    landed = _sign_in_from(browser, provider, path)
    assert landed.status_code == 303 and landed.headers["location"] == "/"


def test_b10_a_refused_sign_in_keeps_the_page_for_the_next_try(client: TestClient, operator: Account,
                                                               provider: Any) -> None:
    test_oidc.configure(client, auto_create=False)
    browser = test_oidc.fresh_browser(client)
    landed = _sign_in_from(browser, provider, "/b/7")
    assert landed.status_code == 303
    assert landed.headers["location"] == "/login?error=oidc_no_account&next=%2Fb%2F7"


_LEVELS = {"debug", "info", "warning", "error", "exception", "critical", "log"}
_KEYED = re.compile(r"(?<![A-Za-z0-9_])(?:name|by)=$")
_PLACE = re.compile(r"%(?:\([^)]*\))?[-#0 +]*\d*(?:\.\d+)?[sdrfiax%]")


#: Functions of the file under check that hand back a name (``def _label(row): return row.name``), set by
#: ``loose_names`` before it reads the calls.
_NAMERS: set[str] = set()


def _gives_name(call: ast.AST) -> bool:
    """``getattr(row, "name")`` or a call of a function that hands back a name."""
    if not isinstance(call, ast.Call):
        return False
    func = call.func
    if isinstance(func, ast.Name) and func.id == "getattr" and len(call.args) >= 2:
        return isinstance(call.args[1], ast.Constant) and call.args[1].value in ("name", "display_name")
    return (isinstance(func, ast.Name) and func.id in _NAMERS) or (isinstance(func, ast.Attribute)
                                                                   and func.attr in _NAMERS)


def _names_in(node: ast.AST, carried: frozenset[str] = frozenset()) -> bool:
    """Whether a ``.name``/``.display_name`` goes into ``node``, also through a variable that holds one, ``getattr``
    or a function that hands one back."""
    return any((isinstance(sub, ast.Attribute) and sub.attr in ("name", "display_name"))
               or (isinstance(sub, ast.Name) and sub.id in carried) or _gives_name(sub) for sub in ast.walk(node))


def _own(body: ast.AST) -> list[ast.AST]:
    """The nodes of one function (or of the module), without those of the functions inside it."""
    nodes, todo = [], list(ast.iter_child_nodes(body))
    while todo:
        node = todo.pop()
        nodes.append(node)
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            todo.extend(ast.iter_child_nodes(node))
    return nodes


def _carried(body: ast.AST) -> frozenset[str]:
    """Variables a function (or the module) fills from a ``.name``/``.display_name``: ``who = row.name``,
    ``old, shown = row.name, row.display_name``, ``who: str = row.name``; also handed on, ``a = who``."""
    names: set[str] = set()
    scope = _own(body)
    for _round in range(3):
        for node in scope:
            pairs: list[tuple[ast.expr, ast.expr]] = []
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Tuple) and isinstance(node.value, ast.Tuple):
                        pairs += list(zip(target.elts, node.value.elts, strict=False))
                    else:
                        pairs.append((target, node.value))
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign, ast.NamedExpr)) and node.value is not None:
                pairs.append((node.target, node.value))
            for target, value in pairs:
                if isinstance(target, ast.Name) and _flows(value, frozenset(names)):
                    names.add(target.id)
    return frozenset(names)


_TEXT_CALLS = {"lower", "upper", "strip", "lstrip", "rstrip", "title", "casefold", "format", "join", "replace"}


def _flows(value: ast.AST, carried: frozenset[str]) -> bool:
    """Whether ``value`` is a name as text (``row.name``, ``row.name[:10]``, ``f"{row.name}"``, ``who.lower()``), not an
    object merely made with one (``Team(name=payload.name)``)."""
    if isinstance(value, ast.Attribute):
        return value.attr in ("name", "display_name")
    if isinstance(value, ast.Name):
        return value.id in carried
    if isinstance(value, ast.JoinedStr):
        return any(_flows(part.value, carried) for part in value.values if isinstance(part, ast.FormattedValue))
    if isinstance(value, ast.BinOp):
        return _flows(value.left, carried) or _flows(value.right, carried)
    if isinstance(value, (ast.BoolOp, ast.IfExp)):
        parts = value.values if isinstance(value, ast.BoolOp) else [value.body, value.orelse]
        return any(_flows(part, carried) for part in parts)
    if isinstance(value, ast.Subscript):
        return _flows(value.value, carried)
    if isinstance(value, ast.Call):
        if _gives_name(value):
            return True
        if isinstance(value.func, ast.Attribute) and value.func.attr in _TEXT_CALLS:
            return _flows(value.func.value, carried) or any(_flows(arg, carried) for arg in value.args)
        if isinstance(value.func, ast.Name) and value.func.id in ("str", "repr") and value.args:
            return _flows(value.args[0], carried)
    return False


def _percent(text: str, values: list[ast.expr]) -> list[tuple[str, ast.expr]]:
    places = [match for match in _PLACE.finditer(text) if match.group() != "%%"]
    return [(text[:match.start()], value) for match, value in zip(places, values, strict=False)]


def loose_names(source: str) -> list[int]:
    """Lines of logger calls that put a ``.name`` or ``.display_name`` of anything into the message without ``name=``
    or ``by=`` right before it, however the message is built: ``%`` placeholders with arguments, an f-string,
    ``"..." % (...)``, ``"...".format(...)``; a message built any other way may carry no name at all."""
    found: set[int] = set()
    tree = ast.parse(source)
    functions = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    _NAMERS.clear()
    for _round in range(3):
        for function in functions:
            carried = _carried(function)
            if any(isinstance(node, ast.Return) and node.value is not None and _flows(node.value, carried)
                   for node in _own(function)):
                _NAMERS.add(function.name)
    for body in [tree, *functions]:
        carried = _carried(body)
        for node in _own(body):
            if isinstance(node, ast.Call) and _loose(node, carried):
                found.add(node.lineno)
    return sorted(found)


def _loose(node: ast.Call, carried: frozenset[str]) -> bool:
    """A call of ``.debug``/``.info``/... on any object (``logger``, ``logging.getLogger(...)``, ``self.log``)."""
    if not (isinstance(node.func, ast.Attribute) and node.func.attr in _LEVELS):
        return False
    if True:
        args = node.args[1:] if node.func.attr == "log" else node.args
        if not args:
            return False
        message, rest = args[0], list(args[1:])
        pairs: list[tuple[str, ast.expr]] | None = None
        if isinstance(message, ast.Constant) and isinstance(message.value, str):
            pairs = _percent(message.value, rest)
        elif isinstance(message, ast.JoinedStr):
            pairs, before = [], ""
            for part in message.values:
                if isinstance(part, ast.FormattedValue):
                    pairs.append((before, part.value))
                    before += "{}"
                else:
                    before += str(getattr(part, "value", ""))
        elif (isinstance(message, ast.BinOp) and isinstance(message.op, ast.Mod)
              and isinstance(message.left, ast.Constant) and isinstance(message.left.value, str)):
            right = message.right
            pairs = _percent(message.left.value, list(right.elts) if isinstance(right, ast.Tuple) else [right])
        elif (isinstance(message, ast.Call) and isinstance(message.func, ast.Attribute)
              and message.func.attr == "format" and isinstance(message.func.value, ast.Constant)):
            text = str(message.func.value.value)
            places = list(re.finditer(r"\{[^{}]*\}", text))
            pairs = [(text[:place.start()], value) for place, value in zip(places, message.args, strict=False)]
        if pairs is None:
            return any(_names_in(arg, carried) for arg in args)
        return any(_names_in(value, carried) and not _KEYED.search(before) for before, value in pairs)


@pytest.mark.parametrize("line", [
    'logger.info("Sessions of %s ended", row.name)',
    'logger.info(f"Sessions of {row.name} ended")',
    'logger.info("Sessions of %s ended (%s)" % (person_row.name, 3))',
    'logger.info("Sessions of {} ended".format(row.display_name))',
    'logger.info("Sessions of " + row.name)',
    'logger.warning("Kept file_name=%s", path.name)',
    'logger.log(20, "Sessions of %s ended", anybody.name)',
    'who = row.name\nlogger.info("Sessions of %s ended", who)',
    'def f(row):\n    old, shown = row.name, 3\n    then = old\n    logger.info(f"was {then}")',
    'logging.getLogger("nexcanvas.suite").info("Sessions of %s ended", row.name)',
    'self.log.warning("Sessions of %s ended", row.display_name)',
    'who = str(row.name)[:20].lower()\nlogger.info("Sessions of %s ended", who)',
    'def _label(row):\n    return row.display_name or row.name\n\nlogger.info("Sessions of %s ended", _label(row))',
    'def _label(row):\n    return row.name\n\nwho = _label(row)\nlogger.info(f"Sessions of {who} ended")',
    'logger.info("Sessions of %s ended", getattr(row, "name"))',
    'class A:\n    def label(self):\n        return self.name\n\nlogger.info("Of %s", self.label())',
])
def test_b21_the_log_guard_sees_every_way_a_name_gets_in(line: str) -> None:
    assert loose_names(line) == [line.count(chr(10)) + 1]


@pytest.mark.parametrize("line", [
    'logger.info("Sessions ended name=%s count=%s", row.name, 3)',
    'logger.info(f"Task done by={account.name}")',
    'logger.info("Saved name=%s" % (target.name,))',
    'logger.info("Kind %s", type(exc).__name__)',
    'who = row.name\nlogger.info("Sessions ended name=%s", who)',
    'def f(row):\n    who = row.name\n\ndef g(who):\n    logger.info("Sessions of %s ended", who)',
    'team = Team(name=payload.name)\nlogger.info("Team made id=%s", team.id)',
    'def _label(row):\n    return row.name\n\nlogger.info("Sessions ended name=%s", _label(row))',
    'def _count(row):\n    return len(row.members)\n\nlogger.info("Members %s", _count(row))',
])
def test_b21_the_log_guard_lets_keyed_names_by(line: str) -> None:
    assert loose_names(line) == []


def test_b21_the_log_names_accounts_where_a_rename_finds_them() -> None:
    """``logs.rename_actor`` follows ``u:<name>``, ``name=<name>`` and ``by=<name>``: a log line that puts a name in
    any other way would keep reading like whoever gets the name next (B21)."""
    loose = []
    for file in pathlib.Path(__file__).resolve().parents[1].joinpath("app").rglob("*.py"):
        loose += [f"{file.name}:{line}" for line in loose_names(file.read_text(encoding="utf-8"))]
    assert loose == []


def test_b24_a_code_too_long_is_a_wrong_code(client: TestClient, operator: Account, fake: FakeSuite) -> None:
    for code in ("A" * 41, "B" * 300):
        answer = client.post("/api/suite/start", json={"url": SUITE, "code": code})
        assert answer.status_code == 409 and _code(answer) == "pair_code_invalid", answer.text
    assert ("POST", "/pair") not in fake.calls
    assert _setting("suite_state") == ""


# --- #job-172a ---------------------------------------------------------------------------------------------------------


def test_job172_a_left_out_account_with_an_old_subject_never_takes_over_a_person(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    """cleo signed in through another provider as "3" before connecting and is left out; zoe as "2", left out too.
    Persons 3 and 2 in nexsuite are erik and anna. Neither left-out account becomes the person, takes its address
    or name, or is let in; signing in as 3 and 2 is erik and anna."""
    zoe = make_account("zoe")
    with SessionLocal() as db:
        cleo = db.get(Account, world["cleo"].id)
        row = db.get(Account, zoe.id)
        assert cleo is not None and row is not None
        cleo.oidc_subject = "3"
        row.oidc_subject, row.email, row.display_name = "2", "zoe@example.com", "Zoe"
        db.commit()
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[zoe.id] = choices[world["cleo"].id] = "skip"
    spaces = {s["id"]: s["suggest"] for s in found["spaces"]}
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": spaces}).status_code == 200
    assert client.post("/api/suite/sync").status_code == 200
    _provider_is_nexsuite()
    cleo, zoe_after, erik, anna = _row("cleo"), _row("zoe"), _row("erik"), _row("anna")
    assert cleo.blocked_at is not None and zoe_after.blocked_at is not None, "left out stays blocked"
    assert (zoe_after.email, zoe_after.display_name) == ("zoe@example.com", "Zoe"), "nothing copied onto it"
    assert cleo.oidc_subject != "3" and zoe_after.oidc_subject != "2", "a subject here means the person in nexsuite"
    assert erik.oidc_subject == "3" and erik.blocked_at is None
    assert anna.oidc_subject == "2" and anna.blocked_at is None
    assert _signs_in_as(client, provider, "3") == "erik"
    assert _signs_in_as(client, provider, "2") == "anna"
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.name.like("erik%")).count() == 1
        assert db.query(Account).filter(Account.oidc_subject == "3").count() == 1


def test_job172_a_connection_from_before_never_hands_a_new_person_to_a_left_out_account(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, provider: Any) -> None:
    """Connected under bf64550: the left-out zoe kept a subject "60" of another provider, blocked and unmarked. A person
    60 made in nexsuite since has no account here; the sync makes one and never gives it zoe's, unblocked."""
    zoe = make_account("zoe")
    connect(client, world, operator)
    _provider_is_nexsuite()
    _legacy({"zoe": "60"}, zoe={"blocked_at": utcnow(), "email": "zoe@example.com", "display_name": "Zoe"})
    fake.people["60"] = {"id": "60", "name": "neu", "display_name": "Neu", "email": "neu@example.com",
                         "operator": False, "blocked": False}
    assert client.post("/api/suite/sync").status_code == 200
    after = _row("zoe")
    assert after.id == zoe.id and after.blocked_at is not None, "left out stays blocked"
    assert (after.oidc_subject, after.suite_person, after.oidc_subject_local) == ("", "", "60")
    assert (after.email, after.display_name) == ("zoe@example.com", "Zoe")
    assert _row("neu").oidc_subject == "60" and _row("neu").blocked_at is None
    assert _signs_in_as(client, provider, "60") == "neu"


# --- B16, B24: what nexsuite answers since 3ef5282 ---------------------------------------------------------------------


@pytest.mark.parametrize("code", ["app_still_connected", "app_not_reachable"])
def test_b24_a_pairing_nexsuite_refuses_for_an_older_connection_says_why(client: TestClient, operator: Account,
                                                                         fake: FakeSuite, code: str) -> None:
    fake.pair_refused = code
    answer = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"})
    # Not "no nexsuite answers at this address": it is one, and it names what to do.
    assert answer.status_code == 409 and _code(answer) == code


def test_b16_a_display_name_goes_to_a_matched_person_without_one(client: TestClient, operator: Account, world: dict,
                                                                 fake: FakeSuite) -> None:
    with SessionLocal() as db:
        anna = db.get(Account, world["anna"].id)
        assert anna is not None
        anna.display_name = "Anna Example"
        db.commit()
    fake.people["2"]["display_name"] = ""
    connect(client, world, operator)
    assert ("POST", "/people/2/name") in fake.calls
    assert fake.people["2"]["display_name"] == "Anna Example"
    assert ("POST", "/people/1/name") not in fake.calls, "a person with a display name keeps it"
    assert _row("anna").display_name == "Anna Example"


def test_b16_a_refused_display_name_does_not_stop_connecting(client: TestClient, operator: Account, world: dict,
                                                             fake: FakeSuite) -> None:
    with SessionLocal() as db:
        anna = db.get(Account, world["anna"].id)
        assert anna is not None
        anna.display_name = "Anna Example"
        db.commit()
    fake.people["2"]["display_name"] = ""
    fake.name_refused = "name_taken"
    connect(client, world, operator)
    assert ("POST", "/people/2/name") in fake.calls
    assert _setting("suite_state") == "connected"


# --- B11: the sign-in page while connected -------------------------------------------------------------------------


def test_b11_the_sign_in_page_learns_where_nexsuite_is_only_while_connected(client: TestClient, operator: Account,
                                                                            world: dict, fake: FakeSuite) -> None:
    with TestClient(app, base_url="http://testserver") as browser:
        assert browser.get("/api/auth/methods").json()["suite_url"] == ""
    connect(client, world, operator)
    with TestClient(app, base_url="http://testserver") as browser:
        assert browser.get("/api/auth/methods").json()["suite_url"] == SUITE


# --- B17: an operator role from nexsuite ends with the connection -----------------------------------------------------


def _set(name: str, **values: Any) -> None:
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name=name).one()
        for key, value in values.items():
            setattr(row, key, value)
        db.commit()


def _leave(client: TestClient, fake: FakeSuite, way: str) -> dict[str, Any]:
    if way == "password":
        answer = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
        assert answer.status_code == 200, answer.text
        return answer.json()
    if way == "code":
        fake.emergency = [hashlib.sha256(b"ABCD1234").hexdigest()]
        client.post("/api/suite/sync")
        answer = client.post("/api/suite/emergency", json={"current_password": PASSWORD, "code": "ABCD-1234"})
        assert answer.status_code == 200, answer.text
        return answer.json()
    body, headers = test_suite._signed(fake.token, {"kind": "disconnected"})
    assert client.post("/api/suite/event", content=body, headers=headers).status_code == 204
    return {}


@pytest.mark.parametrize("way", ["password", "code", "notice"])
def test_b17_an_operator_only_through_nexsuite_is_a_member_again(client: TestClient, operator: Account, world: dict,
                                                                 fake: FakeSuite, way: str) -> None:
    make_account("dora", OPERATOR)
    _set("ben", display_name="Ben Kurz")
    connect(client, world, operator)
    fake.people["2"]["operator"] = True
    ben = _row("ben").oidc_subject
    fake.people[ben]["operator"] = True
    client.post("/api/suite/sync")
    assert _row("anna").role == OPERATOR and _row("ben").role == OPERATOR
    status = client.get("/api/suite").json()
    assert status["roles_kept"] is True and status["operators_staying"] == []
    assert sorted(status["operators_from_suite"]) == ["Anna Berg", "Ben Kurz"], "by the names people see"
    left = _leave(client, fake, way)
    if left:
        assert sorted(left["operators_back"]) == ["Anna Berg", "Ben Kurz"]
    assert _row("anna").role == "member" and _row("ben").role == "member"
    assert _row("tester").role == OPERATOR, "the emergency account stays as it is"


def test_b17_an_operator_from_before_stays_one(client: TestClient, operator: Account, world: dict,
                                               fake: FakeSuite) -> None:
    make_account("dora", OPERATOR)
    connect(client, world, operator)
    dora = _row("dora").oidc_subject
    fake.people[dora]["operator"] = True
    client.post("/api/suite/sync")
    assert client.get("/api/suite").json()["operators_from_suite"] == []
    assert _leave(client, fake, "password")["operators_back"] == []
    assert _row("dora").role == OPERATOR


def test_b17_a_connection_from_before_changes_no_role_and_says_so(client: TestClient, operator: Account,
                                                                  world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.people["2"]["operator"] = True
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        saved = dict(settings_service.get(db, "suite_saved"))
        saved.pop("roles")
        settings_service.save(db, {"suite_saved": saved})
        db.commit()
    status = client.get("/api/suite").json()
    assert status["roles_kept"] is False and status["operators_from_suite"] == []
    assert status["operators_staying"] == ["Anna Berg"]
    assert _leave(client, fake, "password")["operators_back"] == []
    assert _row("anna").role == OPERATOR


def test_b17_only_the_operator_hears_who_stops_being_one(client: TestClient, operator: Account, world: dict,
                                                         fake: FakeSuite) -> None:
    connect(client, world, operator)
    with new_client(world["anna"]) as anna:
        seen = anna.get("/api/suite").json()
    assert set(seen) == {"state", "url"}


# --- B18: a space nexsuite no longer gives ----------------------------------------------------------------------------


def test_b18_a_space_nexsuite_let_go_is_marked_and_the_operator_puts_it_into_the_trash(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    ideen = world["ideen"]
    view = next(s for s in client.get("/api/spaces").json() if s["id"] == ideen)
    assert view["dropped"] is False
    fake.ticked.discard("10")
    client.post("/api/suite/sync")
    view = next(s for s in client.get("/api/spaces").json() if s["id"] == ideen)
    assert view["dropped"] is True and view["managed"] is True
    assert client.patch(f"/api/spaces/{ideen}", json={"name": "Other"}).status_code == 409, "only the trash"
    studio = client.delete(f"/api/spaces/{world['studio']}")
    assert studio.status_code == 409, "a space nexsuite still gives stays nexsuite's"
    with new_client(world["anna"]) as anna:
        assert anna.delete(f"/api/spaces/{ideen}").status_code in (403, 404), "the operator only"
    assert client.delete(f"/api/spaces/{ideen}").status_code == 204
    in_bin = {s["id"]: s for s in client.get("/api/spaces/bin").json()}
    assert in_bin[ideen]["in_suite"] is False, "it comes back here, not in nexsuite"
    assert client.post(f"/api/spaces/{ideen}/restore").status_code == 200
    # Given again: no longer marked.
    fake.ticked.add("10")
    client.post("/api/suite/sync")
    assert next(s for s in client.get("/api/spaces").json() if s["id"] == ideen)["dropped"] is False
    assert client.delete(f"/api/spaces/{ideen}").status_code == 409


def test_b18_a_token_of_the_operator_does_not_put_it_into_the_trash(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.ticked.discard("10")
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        row = db.get(Account, operator.id)
        assert row is not None
        row.via_key = True
        from app.routers import spaces as spaces_router

        with pytest.raises(Exception):  # noqa: B017
            spaces_router.trash(world["ideen"], row, db)
        space = db.get(Space, world["ideen"])
        assert space is not None and space.deleted_at is None


def test_b18_disconnecting_forgets_the_mark(client: TestClient, operator: Account, world: dict,
                                            fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.ticked.discard("10")
    client.post("/api/suite/sync")
    _leave(client, fake, "password")
    with SessionLocal() as db:
        space = db.get(Space, world["ideen"])
        assert space is not None and space.suite_dropped_at is None


def test_b18_a_space_in_nexsuites_trash_stays_nexsuites_through_the_real_sync(client: TestClient, operator: Account,
                                                                              world: dict, fake: FakeSuite) -> None:
    from app.services import cleanup

    connect(client, world, operator)
    made = client.post("/api/boards", json={"space_id": world["ideen"], "title": "Sammlung"})
    assert made.status_code == 201, made.text
    # First its tick goes (marked), then it is deleted there: in nexsuite's trash it is nexsuite's again.
    fake.ticked.discard("10")
    client.post("/api/suite/sync")
    assert next(s for s in client.get("/api/spaces").json() if s["id"] == world["ideen"])["dropped"] is True
    fake.bin = [{"id": "10", "deleted_at": (utcnow() - timedelta(days=31)).isoformat()}]
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        space = db.get(Space, world["ideen"])
        assert space is not None and space.suite_dropped_at is None
    cleanup.run_once()
    with SessionLocal() as db:
        assert db.get(Space, world["ideen"]) is not None, "the clock here does not empty nexsuite's trash"
        assert db.query(Board).filter_by(title="Sammlung").count() == 1
    in_bin = {s["id"]: s for s in client.get("/api/spaces/bin").json()}
    assert in_bin[world["ideen"]]["in_suite"] is True
    refused = client.post(f"/api/spaces/{world['ideen']}/restore")
    assert refused.status_code == 409 and _code(refused) == "managed_by_suite"
    # Brought back there: back here with its board.
    fake.bin, fake.ticked = [], {"10", *fake.ticked}
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        space = db.get(Space, world["ideen"])
        assert space is not None and space.deleted_at is None
        assert db.query(Board).filter_by(title="Sammlung").count() == 1


def test_b18_the_operator_s_trash_empties_a_let_go_space_by_the_clock(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    from app.services import cleanup

    connect(client, world, operator)
    fake.ticked.discard("10")
    client.post("/api/suite/sync")
    assert client.delete(f"/api/spaces/{world['ideen']}").status_code == 204
    with SessionLocal() as db:
        space = db.get(Space, world["ideen"])
        assert space is not None
        space.deleted_at = utcnow() - timedelta(days=31)
        db.commit()
    cleanup.run_once()
    with SessionLocal() as db:
        assert db.get(Space, world["ideen"]) is None, "nexsuite says nothing about it: the clock here counts"


# --- A10: a notice from nexsuite is taken once, and a strange signature is simply wrong ------------------------------


def _signed_at(token: str, payload: dict[str, Any], stamp: int) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload).encode()
    sig = hmac.new(token.encode(), str(stamp).encode() + b"." + body, hashlib.sha256).hexdigest()
    return body, {"X-Nexsuite-Time": str(stamp), "X-Nexsuite-Signature": sig, "Content-Type": "application/json"}


NOW = 1_800_000_000


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """The notice check reads a fixed clock (nothing else of ``suite`` reads ``time.time`` during these calls)."""
    monkeypatch.setattr(suite, "time", types.SimpleNamespace(time=lambda: NOW, monotonic=time.monotonic,
                                                             sleep=time.sleep))


def test_a10_a_notice_is_taken_once_and_only_within_the_window(client: TestClient, operator: Account, world: dict,
                                                              fake: FakeSuite, clock: None) -> None:
    connect(client, world, operator)
    program = TestClient(app, base_url="http://testserver")
    body, head = _signed_at(fake.token, {"revision": 8, "kind": "changed"}, NOW)
    assert program.post("/api/suite/event", content=body, headers=head).status_code == 204
    assert program.post("/api/suite/event", content=body, headers=head).status_code == 401, "the same notice twice"
    for stamp in (NOW - 301, NOW + 301):
        body, head = _signed_at(fake.token, {"revision": 9, "kind": "changed"}, stamp)
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 401, stamp
    for stamp in (NOW - 299, NOW + 299):
        body, head = _signed_at(fake.token, {"revision": 10, "kind": "changed", "at": stamp}, stamp)
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 204, stamp


def test_a10_a_signature_beyond_ascii_is_refused_not_a_failure(client: TestClient, operator: Account, world: dict,
                                                              fake: FakeSuite, clock: None) -> None:
    connect(client, world, operator)
    program = TestClient(app, base_url="http://testserver", raise_server_exceptions=False)
    body, head = _signed_at(fake.token, {"revision": 8, "kind": "changed"}, NOW)
    for signature in ("ä" * 64, head["X-Nexsuite-Signature"][:-1] + "é"):
        answer = program.post("/api/suite/event", content=body,
                              headers={**head, "X-Nexsuite-Signature": signature.encode("latin-1")})  # type: ignore[dict-item]
        assert answer.status_code == 401, signature
    # Digits that are not ASCII are no time (superscript two is a digit to Python, and Latin-1).
    answer = program.post("/api/suite/event", content=body,
                          headers={**head, "X-Nexsuite-Time": "18000000²".encode("latin-1")})  # type: ignore[dict-item]
    assert answer.status_code == 401
    # The test client sends that header in UTF-8, so the server reads two characters; as it would arrive in Latin-1
    # (one character, a digit to str.isdigit and none to int), the check itself says no instead of failing.
    with SessionLocal() as db:
        for stamp in ("18000000²", "¹" * 10):
            assert suite.check_notice(db, stamp, head["X-Nexsuite-Signature"], body) is None, ascii(stamp)


# --- What nexsuite sends passes the checks typed input passes ----------------------------------------------------------


def test_cleaning_a_display_name_from_nexsuite_loses_control_and_format_characters(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.people["2"]["display_name"] = "Anna\x85 \x9bBerg\u202e\x00"
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("anna").display_name == "Anna Berg"


def test_cleaning_team_and_space_names_from_nexsuite_lose_control_characters(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """nexsuite takes DEL and C1 in names; they came over raw. Typed here they are refused."""
    connect(client, world, operator)
    fake.teams["70"] = {"id": "70", "name": "Netz\x7fwerk\x9b31m", "color": "#123456", "lead": None, "members": ["1"]}
    fake.spaces["11"] = {"id": "11", "name": "Netz\x7fwerk\x9b31m", "color": "#123456",
                         "people": [{"id": "1", "role": "manage"}], "teams": []}
    fake.ticked.add("11")
    assert client.post("/api/suite/sync").status_code == 200
    with SessionLocal() as db:
        assert db.query(Team).filter_by(external_id="70").one().name == "Netzwerk31m"
        assert db.query(Space).filter_by(external_id="11").one().name == "Netzwerk31m"
    # A name that changes to nothing but control characters keeps the one it had.
    fake.teams["70"]["name"] = fake.spaces["11"]["name"] = "\x7f\x9b"
    assert client.post("/api/suite/sync").status_code == 200
    with SessionLocal() as db:
        assert db.query(Team).filter_by(external_id="70").one().name == "Netzwerk31m"
        assert db.query(Space).filter_by(external_id="11").one().name == "Netzwerk31m"


@pytest.mark.parametrize("address", ["anna\x00@example.com", "anna\x85@example.com", "anna@exa\x1bmple.com",
                                     "not an address"])
def test_cleaning_an_address_from_nexsuite_that_fails_the_check_is_not_kept(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, address: str,
        caplog: pytest.LogCaptureFixture) -> None:
    connect(client, world, operator)
    fake.people["2"]["email"] = address
    with caplog.at_level("WARNING", logger="nexcanvas.suite"):
        assert client.post("/api/suite/sync").status_code == 200
    assert _row("anna").email == ""
    assert any("address from nexsuite refused" in r.getMessage() and "name=anna" in r.getMessage()
               for r in caplog.records)
    fake.people["2"]["email"] = "anna.berg@example.com"
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("anna").email == "anna.berg@example.com"


# --- Review of ba44488: a connection that fails at its last step, a person deleted before the update ---------------


def _snapshot() -> tuple[dict[str, tuple[Any, ...]], dict[int, tuple[str, str]], dict[int, str]]:
    """What connecting changes here: each account's subjects, mark, block and way in; teams; spaces."""
    with SessionLocal() as db:
        return ({row.name: (row.oidc_subject, row.oidc_subject_local, row.suite_person, row.blocked_at is None,
                            row.sign_in) for row in db.query(Account)},
                {team.id: (team.source, team.external_id) for team in db.query(Team)},
                {space.id: space.external_id for space in db.query(Space)})


def _choices(client: TestClient, world: dict) -> dict[str, Any]:
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    accounts = {a["id"]: a["suggest"] for a in found["accounts"]}
    accounts[world["cleo"].id] = "skip"
    return {"accounts": accounts, "spaces": {s["id"]: s["suggest"] for s in found["spaces"]}}


def test_finish_failing_at_its_last_step_changes_nothing_here_and_abort_leaves_it_so(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    with SessionLocal() as db:  # cleo signed in through authentik before
        db.get(Account, world["cleo"].id).oidc_subject = "authentik-hash-of-cleo"  # type: ignore[union-attr]
        db.commit()
    before = _snapshot()
    chosen = _choices(client, world)
    fake.fail_on = "/finish"
    answer = client.post("/api/suite/finish", json=chosen)
    assert answer.status_code in (409, 502) and _code(answer) == "suite_unreachable", answer.text
    assert _setting("suite_state") == "connecting"
    assert _snapshot() == before, "nothing here changes before nexsuite has the connection"
    assert client.post("/api/suite/abort").status_code == 204
    assert _setting("suite_state") == ""
    assert _snapshot() == before, "given up, everything is as before connecting"
    assert _row("cleo").oidc_subject == "authentik-hash-of-cleo" and _row("cleo").blocked_at is None


def test_finish_again_after_a_failed_last_step_connects_once(client: TestClient, operator: Account, world: dict,
                                                           fake: FakeSuite) -> None:
    chosen = _choices(client, world)
    fake.fail_on = "/finish"
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    people, teams = len(fake.people), len(fake.teams)
    done = client.post("/api/suite/finish", json=chosen)
    assert done.status_code == 200, done.text
    assert _setting("suite_state") == "connected"
    assert len(fake.people) == people and len(fake.teams) == teams, "what was made before is used, not made again"
    assert len([s for s in fake.spaces.values() if s["name"] == "Studio"]) == 1
    assert _row("anna").oidc_subject == "2" and _row("cleo").blocked_at is not None
    with SessionLocal() as db:
        team = db.get(Team, world["team"])
        space = db.get(Space, world["studio"])
        assert team is not None and team.source == "admin" and team.external_id in fake.teams
        assert space is not None and space.external_id in fake.ticked


def test_abort_in_another_tab_waits_for_a_finish_under_way(client: TestClient, operator: Account, world: dict,
                                                           fake: FakeSuite, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tab 1 connects and nexsuite is slow to confirm; tab 2 gives up meanwhile. The give-up waits for the finish and
    then finds the connection done (409), instead of forgetting it half way."""
    chosen = _choices(client, world)
    reached, go = threading.Event(), threading.Event()
    real = fake.handle

    def slow(method: str, url: str, **kwargs: Any) -> Any:
        if url.endswith("/api/connect/v1/finish"):
            reached.set()
            assert go.wait(10)
        return real(method, url, **kwargs)

    monkeypatch.setattr(suite, "request", slow)
    results: dict[str, int] = {}

    def finishing() -> None:
        results["finish"] = client.post("/api/suite/finish", json=chosen).status_code

    def aborting() -> None:
        results["abort"] = client.post("/api/suite/abort").status_code

    first = threading.Thread(target=finishing)
    first.start()
    assert reached.wait(10), "the finish reaches nexsuite"
    second = threading.Thread(target=aborting)
    second.start()
    second.join(0.5)
    go.set()
    first.join(20)
    second.join(20)
    assert results == {"finish": 200, "abort": 409}
    assert _setting("suite_state") == "connected" and _setting("suite_url") == SUITE and _setting("suite_token_enc")
    assert ("POST", "/leave") not in fake.calls


def test_b8_a_blocked_account_is_not_matched_to_a_free_person_by_address_or_name(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    _disconnect(client, fake)
    with SessionLocal() as db:
        db.get(Account, world["cleo"].id).email = "cleo@example.com"  # type: ignore[union-attr]
        db.commit()
    fake.people["70"] = {"id": "70", "name": "cleo", "display_name": "Cleo", "email": "cleo@example.com",
                         "operator": False, "blocked": False}
    rows = _again(client)
    assert rows["cleo"]["suggest"] == "skip" and rows["cleo"]["blocked"] is True


def test_b8_an_account_nexsuite_brought_and_left_out_now_is_nobody_s_any_more(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    _disconnect(client, fake)
    assert _row("anna").suite_person == "2"
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[world["anna"].id] = "skip"
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}}).status_code == 200
    anna = _row("anna")
    assert (anna.oidc_subject, anna.suite_person) == ("", ""), "left out now, its former person is not its own"
    assert anna.blocked_at is not None


def test_settled_the_emergency_account_is_never_blocked(client: TestClient, operator: Account, world: dict,
                                                         fake: FakeSuite) -> None:
    """Connected under bf64550, zoe was given person 1 and the emergency account kept the same subject unmarked:
    settled, zoe keeps the person and the emergency account is put apart, but never locked out."""
    zoe = make_account("zoe")
    connect(client, world, operator)
    _legacy({"tester": "1", "zoe": "1"})
    with SessionLocal() as db:
        db.get(Account, zoe.id).suite_person = "1"  # type: ignore[union-attr]
        db.commit()
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("zoe").oidc_subject == "1"
    keeper = _row("tester")
    assert keeper.oidc_subject == "" and keeper.blocked_at is None


def test_settled_a_person_deleted_before_the_update_leaves_no_link_behind(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    """Connected under bf64550, anna's person was deleted in nexsuite and her account blocked. Her subject was
    nexsuite's, not a link of her own: after a disconnect she has no link and signs in with her password again, and
    connecting again says that her person is gone."""
    connect(client, world, operator)
    del fake.people["2"]
    assert client.post("/api/suite/sync").status_code == 200
    _legacy({"anna": "2"}, anna={"blocked_at": utcnow()})
    assert client.post("/api/suite/sync").status_code == 200
    anna = _row("anna")
    assert anna.oidc_subject_local == "" and anna.blocked_at is not None
    _disconnect(client, fake)
    anna = _row("anna")
    assert (anna.oidc_subject, anna.oidc_subject_local, anna.sign_in) == ("", "", "password")
    rows = _again(client)
    assert rows["anna"]["gone"] is True and rows["anna"]["suggest"] == "skip"


# --- Review of 4f54522: nexsuite took /finish, nexcanvas did not hear it ---------------------------------------------


def _connected_here(world: dict) -> None:
    assert _setting("suite_state") == "connected" and _setting("suite_pending") is None
    assert _row("anna").oidc_subject == "2" and _row("cleo").blocked_at is not None
    with SessionLocal() as db:
        team = db.get(Team, world["team"])
        space = db.get(Space, world["studio"])
        assert team is not None and team.source == "admin" and team.external_id
        assert space is not None and space.external_id


def test_finish_whose_answer_got_lost_finishes_with_the_next_try(client: TestClient, operator: Account, world: dict,
                                                                fake: FakeSuite, monkeypatch: pytest.MonkeyPatch) -> None:
    """nexsuite took /finish, the answer never came. The next try sends only /finish again; nexsuite's
    already_connected (asked with this app's token) is the confirmation."""
    chosen = _choices(client, world)
    real = fake.handle
    lost = {"once": True}

    def losing(method: str, url: str, **kwargs: Any) -> Any:
        answer = real(method, url, **kwargs)
        if url.endswith("/api/connect/v1/finish") and lost.pop("once", False):
            raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
        return answer

    monkeypatch.setattr(suite, "request", losing)
    failed = client.post("/api/suite/finish", json=chosen)
    assert failed.status_code in (409, 502) and _code(failed) == "suite_unreachable"
    assert fake.connected and _setting("suite_state") == "connecting"
    people, teams = len(fake.people), len(fake.teams)
    calls = len(fake.calls)
    done = client.post("/api/suite/finish", json=chosen)
    assert done.status_code == 200, done.text
    _connected_here(world)
    again = [call for call in fake.calls[calls:] if call[0] == "POST" and call[1] != "/finish"]
    assert again == [], "nothing but /finish is sent again"
    assert len(fake.people) == people and len(fake.teams) == teams


def test_finish_whose_local_commit_failed_finishes_with_the_next_try(client: TestClient, operator: Account,
                                                                   world: dict, fake: FakeSuite,
                                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    """nexsuite confirmed /finish, then writing it here failed (a full disk, a lock): nothing here changed, and the
    next try writes it."""
    chosen = _choices(client, world)
    real = settings_service.save
    broken = {"once": True}

    def failing(db: Any, changes: dict[str, Any]) -> None:
        if changes.get("suite_state") == "connected" and broken.pop("once", False):
            raise RuntimeError("the disk is full")
        real(db, changes)

    monkeypatch.setattr(settings_service, "save", failing)
    with TestClient(client.app, base_url="http://testserver", headers=dict(client.headers),
                    raise_server_exceptions=False, cookies=client.cookies) as same:
        assert same.post("/api/suite/finish", json=chosen).status_code == 500
    assert fake.connected and _setting("suite_state") == "connecting"
    assert _row("anna").oidc_subject == "" and _row("cleo").blocked_at is None, "nothing written here"
    done = client.post("/api/suite/finish", json=chosen)
    assert done.status_code == 200, done.text
    _connected_here(world)


def test_finish_sent_and_given_up_tells_nexsuite_to_forget(client: TestClient, operator: Account, world: dict,
                                                           fake: FakeSuite, monkeypatch: pytest.MonkeyPatch) -> None:
    chosen = _choices(client, world)
    real = fake.handle

    def losing(method: str, url: str, **kwargs: Any) -> Any:
        answer = real(method, url, **kwargs)
        if url.endswith("/api/connect/v1/finish"):
            raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
        return answer

    monkeypatch.setattr(suite, "request", losing)
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    assert client.post("/api/suite/abort").status_code == 204
    assert ("POST", "/leave") in fake.calls and not fake.connected
    assert _setting("suite_state") == "" and _row("anna").oidc_subject == ""


def test_settled_an_oidc_account_without_a_password_keeps_its_own_link(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    """Connected under bf64550: dora came through authentik (no password of her own) and was left out, keeping her
    link. Her subject is no person of nexsuite's: she keeps it apart and gets it back on disconnecting."""
    from app.services import accounts

    with SessionLocal() as db:
        dora_id = accounts.create_oidc(db, "dora", "authentik-hash-of-dora", "dora@example.com").id
    chosen = _choices(client, world)
    chosen["accounts"][dora_id] = "skip"
    assert client.post("/api/suite/finish", json=chosen).status_code == 200
    _legacy({"dora": "authentik-hash-of-dora"}, dora={"blocked_at": utcnow()})
    assert client.post("/api/suite/sync").status_code == 200
    dora = _row("dora")
    assert (dora.oidc_subject, dora.suite_person, dora.oidc_subject_local) == ("", "", "authentik-hash-of-dora")
    _disconnect(client, fake)
    dora = _row("dora")
    assert (dora.oidc_subject, dora.suite_person, dora.sign_in) == ("authentik-hash-of-dora", "", "oidc")
    rows = _again(client)
    assert rows["dora"]["from_suite"] is False and rows["dora"]["gone"] is False


def test_the_proposal_says_when_something_was_made_in_nexsuite_already(client: TestClient, operator: Account,
                                                                       world: dict, fake: FakeSuite) -> None:
    chosen = _choices(client, world)
    assert client.get("/api/suite/proposal").json()["made"] == 0
    fake.fail_on = "/spaces"
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    assert client.get("/api/suite/proposal").json()["made"] == 2, "ben as a person and the team Design"


# --- Review of e709c94: once /finish went out, the choices of then hold ----------------------------------------------


def _lose_finish_once(fake: FakeSuite, monkeypatch: pytest.MonkeyPatch) -> None:
    real = fake.handle
    lost = {"once": True}

    def losing(method: str, url: str, **kwargs: Any) -> Any:
        answer = real(method, url, **kwargs)
        if url.endswith("/api/connect/v1/finish") and lost.pop("once", False):
            raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
        return answer

    monkeypatch.setattr(suite, "request", losing)


def test_after_finish_went_out_other_choices_are_refused_not_ignored(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    """The answer to /finish got lost; the operator then tries to set anna to "leave out", or to change a team. Keeping
    that is refused (the assistant shows the choices of then, locked); finishing sends /finish again and applies the
    choices of then, whatever comes along with it (decided 2026-10-07)."""
    chosen = _choices(client, world)
    _lose_finish_once(fake, monkeypatch)
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    assert client.get("/api/suite/proposal").json()["sent"] is True
    other = {**chosen, "accounts": {**chosen["accounts"], world["anna"].id: "skip"}}
    kept = client.put("/api/suite/choices", json={**other, "teams": {}, "step": 2})
    assert kept.status_code == 409 and _code(kept) == "connection_sent"
    team_only = client.put("/api/suite/choices", json={**chosen, "teams": {str(world["team"]): "70"}, "step": 3})
    assert team_only.status_code == 409 and _code(team_only) == "connection_sent"
    assert _setting("suite_state") == "connecting" and _row("anna").oidc_subject == ""
    done = client.post("/api/suite/finish", json=other)
    assert done.status_code == 200, done.text
    assert _row("anna").oidc_subject == "2" and _row("anna").blocked_at is None, "the choices of then"


def _sent_and_lost(client: TestClient, world: dict, fake: FakeSuite, monkeypatch: pytest.MonkeyPatch) -> dict:
    chosen = _choices(client, world)
    _lose_finish_once(fake, monkeypatch)
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    assert fake.connected
    return chosen


def test_after_reloading_the_assistant_shows_what_was_sent_and_finishes_with_it(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite,
        monkeypatch: pytest.MonkeyPatch) -> None:
    """R5: nexsuite has the connection, so it offers no space any more. The proposal still names the choices that
    went out, with the names of their targets, and finishing with them works."""
    chosen = _sent_and_lost(client, world, fake, monkeypatch)
    found = client.get("/api/suite/proposal").json()
    assert found["sent"] is True
    assert found["chosen"]["spaces"][str(world["ideen"])] == "10"
    assert {"id": "10", "name": "Ideen", "color": "#f472b6"} in found["candidates"], "the target by its name"
    assert found["chosen"]["accounts"] == {str(k): v for k, v in chosen["accounts"].items()}
    assert {person["id"] for person in found["people"]} >= {"1", "2", "3"}
    body = {key: found["chosen"][key] for key in ("accounts", "spaces", "teams")}
    done = client.post("/api/suite/finish", json=body)
    assert done.status_code == 200, done.text
    with SessionLocal() as db:
        ideen = db.get(Space, world["ideen"])
        assert ideen is not None and ideen.external_id == "10"


def test_an_account_made_after_sending_is_not_in_the_list_and_stops_nothing(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite,
        monkeypatch: pytest.MonkeyPatch) -> None:
    """R6: an account made here after /finish went out is not among the choices, and a finish that brings it along
    still finishes; nothing is made for it in nexsuite."""
    chosen = _sent_and_lost(client, world, fake, monkeypatch)
    late = make_account("spaet")
    found = client.get("/api/suite/proposal").json()
    assert "spaet" not in {row["name"] for row in found["accounts"]}
    people = len(fake.people)
    body = {**chosen, "accounts": {**chosen["accounts"], late.id: "new"}}
    done = client.post("/api/suite/finish", json=body)
    assert done.status_code == 200, done.text
    assert len(fake.people) == people
    assert _row("spaet").oidc_subject == ""


def test_giving_up_after_finish_went_out_says_when_nexsuite_may_still_list_the_app(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite,
        monkeypatch: pytest.MonkeyPatch) -> None:
    chosen = _choices(client, world)
    _lose_finish_once(fake, monkeypatch)
    assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    fake.down = True
    answer = client.post("/api/suite/abort")
    assert answer.status_code == 200 and answer.json() == {"kept_in_suite": True}
    assert _setting("suite_state") == ""


def test_giving_up_before_finish_went_out_says_nothing_more(client: TestClient, operator: Account, world: dict,
                                                            fake: FakeSuite) -> None:
    _choices(client, world)
    fake.down = True
    assert client.post("/api/suite/abort").status_code == 204
    fake.down = False
    _choices(client, world)
    assert client.post("/api/suite/abort").status_code == 204


# --- Review of 7afa9c1: what the plan has no place for ----------------------------------------------------------------


@pytest.mark.parametrize("way", ["at once", "after a lost answer"])
@pytest.mark.parametrize("role", [OPERATOR, "member"])
def test_an_account_without_a_place_in_the_plan_is_blocked_like_one_left_out(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite, monkeypatch: pytest.MonkeyPatch,
        role: str, way: str) -> None:
    """Made between pairing and finishing, or after /finish went out: no person in nexsuite, so no way in while
    connected; never a password sign-in of its own beside nexsuite."""
    chosen = _choices(client, world)
    if way == "after a lost answer":
        _lose_finish_once(fake, monkeypatch)
        assert client.post("/api/suite/finish", json=chosen).status_code in (409, 502)
    make_account("neuchef", role)
    done = client.post("/api/suite/finish", json=chosen)
    assert done.status_code == 200, done.text
    late = _row("neuchef")
    assert late.blocked_at is not None and late.oidc_subject == "" and late.suite_person == ""
    with new_client() as browser:
        refused = browser.post("/api/auth/login", json={"name": "neuchef", "password": PASSWORD})
        assert refused.status_code != 200
    assert _row("tester").blocked_at is None, "never the emergency account"


def test_a_left_out_account_deleted_between_the_tries_stops_nothing(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite,
        monkeypatch: pytest.MonkeyPatch) -> None:
    chosen = _sent_and_lost(client, world, fake, monkeypatch)
    with SessionLocal() as db:
        cleo = db.get(Account, world["cleo"].id)
        assert cleo is not None
        db.delete(cleo)
        db.commit()
    done = client.post("/api/suite/finish", json=chosen)
    assert done.status_code == 200, done.text
    assert _setting("suite_state") == "connected"


def test_after_sending_a_chosen_person_deleted_in_nexsuite_still_shows_by_its_name(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite,
        monkeypatch: pytest.MonkeyPatch) -> None:
    _sent_and_lost(client, world, fake, monkeypatch)
    del fake.people["2"]
    del fake.people["3"]
    found = client.get("/api/suite/proposal").json()
    people = {person["id"]: person["name"] for person in found["people"]}
    assert people.get("2") == "anna" and people.get("3") == "erik", "the targets of then, by name"
    assert found["chosen"]["step"] == 3, "the assistant opens at the last step"

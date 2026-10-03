"""nexcanvas hung on nexsuite: connecting with the matches, keeping in step, what is kept there, the way back.

nexsuite is played by ``FakeSuite`` (its app API as ``docs/connect.md`` in nexsuite describes it); the whole round
with both real servers runs in the browser check against the test instances.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections.abc import Iterator
from typing import Any

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Account, AuthSession, Membership, Space, Team, TeamGrant, TeamMember
from app.services import settings_service, suite

from .conftest import PASSWORD, make_account, new_client

SUITE = "https://suite.example.com"


class FakeSuite:
    def __init__(self) -> None:
        self.token = "nxs_" + secrets.token_urlsafe(12)
        self.people: dict[str, dict[str, Any]] = {
            "1": {"id": "1", "name": "robin", "display_name": "Robin Adler", "email": "tester@example.com",
                  "operator": True, "blocked": False},
            "2": {"id": "2", "name": "anna", "display_name": "Anna Berg", "email": "anna@example.com",
                  "operator": False, "blocked": False},
            "3": {"id": "3", "name": "erik", "display_name": "Erik", "email": "", "operator": False,
                  "blocked": False},
        }
        self.teams: dict[str, dict[str, Any]] = {}
        self.spaces: dict[str, dict[str, Any]] = {"10": {"id": "10", "name": "Ideen", "color": "#f472b6",
                                                          "people": [{"id": "1", "role": "manage"}], "teams": []}}
        self.ticked: set[str] = set()
        self.connected = False
        self.known = True
        self.mail: dict[str, Any] | None = None
        self.emergency: list[str] = []
        self.calls: list[tuple[str, str]] = []
        self.next = 100

    def _id(self) -> str:
        self.next += 1
        return str(self.next)

    def seal(self, data: dict[str, Any]) -> str:
        key = hashlib.sha256(b"nexsuite-seal:" + self.token.encode()).digest()
        nonce = os.urandom(12)
        return base64.urlsafe_b64encode(nonce + AESGCM(key).encrypt(nonce, json.dumps(data).encode(),
                                                                     b"nexsuite-mail")).decode()

    def handle(self, method: str, url: str, *, token: str = "", body: Any = None) -> Any:
        assert url.startswith(SUITE + "/api/connect/v1/"), url
        path = url[len(SUITE + "/api/connect/v1"):]
        self.calls.append((method, path))
        if path == "/pair":
            assert body["kind"] == "nexcanvas" and body["redirect_uri"].endswith("/api/oidc/callback")
            if body["code"] != "GOOD-CODE-1234":
                raise suite.SuiteError("pair_code_invalid", "nexsuite refused.", 409)
            return {"app_id": 1, "client_id": "nxs-client", "client_secret": "the-client-secret",
                    "token": self.token, "issuer": SUITE}
        if token != self.token or not self.known:
            raise suite.SuiteError("suite_refused", "nexsuite does not know this app any more.", 409)
        if path == "/directory":
            return {
                "revision": 7, "suite": {"name": "nexsuite", "url": SUITE},
                "people": list(self.people.values()), "teams": list(self.teams.values()),
                "spaces": [s for k, s in self.spaces.items() if k in self.ticked],
                "mail": self.seal(self.mail) if self.mail else None, "emergency": self.emergency,
                "candidates": [] if self.connected else [{"id": k, "name": s["name"], "color": s["color"]}
                                                         for k, s in self.spaces.items()],
            }
        if path == "/people":
            pid = self._id()
            self.people[pid] = {"id": pid, "name": body["name"], "display_name": body["display_name"],
                                "email": body["email"], "operator": False, "blocked": False}
            return {"id": pid, "name": body["name"]}
        if path == "/teams":
            tid = self._id()
            self.teams[tid] = {"id": tid, "name": body["name"], "color": body["color"], "lead": body["lead"],
                               "members": body["members"]}
            return {"id": tid, "name": body["name"]}
        if path == "/spaces":
            sid = self._id()
            self.spaces[sid] = {"id": sid, "name": body["name"], "color": "#f472b6", "people": body["people"],
                                "teams": body["teams"]}
            self.ticked.add(sid)
            return {"id": sid, "name": body["name"]}
        if path.startswith("/spaces/") and path.endswith("/tick"):
            self.ticked.add(path.split("/")[2])
            return None
        if path == "/finish":
            self.connected = True
            return None
        if path in ("/leave", "/report"):
            return None
        raise AssertionError(path)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSuite]:
    played = FakeSuite()
    monkeypatch.setattr(suite, "request", played.handle)
    monkeypatch.setattr(suite, "INLINE", True)
    yield played


def _row(name: str) -> Account:
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name=name).one()
        db.expunge(row)
    return row


def _setting(key: str) -> Any:
    with SessionLocal() as db:
        return settings_service.get(db, key)


@pytest.fixture
def world(client: TestClient, operator: Account) -> dict[str, Any]:
    """Here, before connecting: the operator (address tester@example.com), anna (matches anna in nexsuite), ben (no
    match), cleo (left out); a team Design (anna, ben); spaces Studio (anna writes, Design reads) and Ideen."""
    with SessionLocal() as db:
        db.get(Account, operator.id).email = "tester@example.com"  # type: ignore[union-attr]
        db.commit()
    anna, ben, cleo = make_account("anna"), make_account("ben"), make_account("cleo")
    make_account("erik")
    with SessionLocal() as db:
        db.get(Account, anna.id).email = "anna@example.com"  # type: ignore[union-attr]
        db.commit()
    team = client.post("/api/teams", json={"name": "Design", "members": [anna.id, ben.id], "lead": anna.id}).json()
    studio = client.post("/api/spaces", json={"name": "Studio"}).json()["id"]
    ideen = client.post("/api/spaces", json={"name": "ideen"}).json()["id"]
    from .conftest import join

    join(client, studio, "anna", "write")
    client.put(f"/api/spaces/{studio}/teams/{team['id']}", json={"role": "read"})
    return {"anna": anna, "ben": ben, "cleo": cleo, "team": team["id"], "studio": studio, "ideen": ideen}


def connect(client: TestClient, world: dict[str, Any], operator: Account) -> dict[str, Any]:
    proposal = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"})
    assert proposal.status_code == 200, proposal.text
    found = proposal.json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[world["cleo"].id] = "skip"
    spaces = {s["id"]: s["suggest"] for s in found["spaces"]}
    done = client.post("/api/suite/finish", json={"accounts": choices, "spaces": spaces})
    assert done.status_code == 200, done.text
    return found


def test_connecting_matches_accounts_and_spaces_and_brings_the_rest(client: TestClient, operator: Account,
                                                                    world: dict, fake: FakeSuite) -> None:
    found = connect(client, world, operator)
    suggested = {a["name"]: a["suggest"] for a in found["accounts"]}
    assert suggested == {"tester": "1", "anna": "2", "ben": "new", "cleo": "new", "erik": "3"}
    assert {s["name"]: s["suggest"] for s in found["spaces"]}["ideen"] == "10", "names match whatever the case"
    assert _setting("suite_state") == "connected"
    assert _setting("oidc_issuer") == SUITE and _setting("oidc_client_id") == "nxs-client"
    assert _setting("password_login") is False
    assert _row("anna").oidc_subject == "2" and _row("tester").oidc_subject == "1"
    ben_id = _row("ben").oidc_subject
    assert fake.people[ben_id]["name"] == "ben"
    assert _row("cleo").blocked_at is not None and "cleo" not in [p["name"] for p in fake.people.values()]
    with SessionLocal() as db:
        team = db.get(Team, world["team"])
        assert team is not None and team.source == "admin" and fake.teams[team.external_id]["members"] == ["2", ben_id]
        studio = db.get(Space, world["studio"])
        assert studio is not None and studio.external_id in fake.ticked
        assert fake.spaces[studio.external_id]["people"] == [{"id": "1", "role": "manage"}, {"id": "2", "role": "write"}]
        assert fake.spaces[studio.external_id]["teams"] == [{"id": team.external_id, "role": "read"}]
        assert db.get(Space, world["ideen"]).external_id == "10"  # type: ignore[union-attr]
    assert ("POST", "/finish") in fake.calls


def test_the_operator_must_keep_a_person_and_a_wrong_code_changes_nothing(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    wrong = client.post("/api/suite/start", json={"url": SUITE, "code": "BAD-CODE"})
    assert wrong.status_code == 409 and _setting("suite_state") == ""
    found = client.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[operator.id] = "skip"
    refused = client.post("/api/suite/finish", json={"accounts": choices, "spaces": {}})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "operator_unmatched"
    assert _setting("suite_state") == "connecting"
    assert client.post("/api/suite/abort").status_code == 204
    assert _setting("suite_state") == "" and ("POST", "/leave") in fake.calls
    anna = world["anna"]
    with new_client(anna) as browser:
        assert browser.post("/api/suite/start", json={"url": SUITE, "code": "GOOD-CODE-1234"}).status_code == 403


def test_keeping_in_step_follows_people_teams_spaces_and_mail(client: TestClient, operator: Account,
                                                              world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    anna = world["anna"]
    browser = new_client(anna)
    assert browser.get("/api/spaces").status_code == 200
    fake.people["2"]["display_name"] = "Anna Berg-Roth"
    fake.people["2"]["blocked"] = True
    fake.people["50"] = {"id": "50", "name": "dora", "display_name": "Dora", "email": "dora@example.com",
                         "operator": False, "blocked": False}
    studio_id = _row_space(world["studio"]).external_id
    fake.spaces[studio_id]["people"] = [{"id": "1", "role": "manage"}, {"id": "50", "role": "read"}]
    fake.ticked.discard("10")
    fake.mail = {"host": "smtp.example.com", "port": 465, "security": "tls", "user": "suite", "password": "pw",
                 "from": "suite@example.com"}
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("anna").display_name == "Anna Berg-Roth" and _row("anna").blocked_at is not None
    assert browser.get("/api/spaces").status_code == 401, "a blocked person is signed out at once"
    browser.close()
    with SessionLocal() as db:
        assert db.query(AuthSession).filter_by(account_id=anna.id).count() == 0
    dora = _row("dora")
    with SessionLocal() as db:
        grants = {m.account_id: m.role for m in db.query(Membership).filter_by(space_id=world["studio"])}
        assert grants == {operator.id: "manage", dora.id: "read"}
        assert db.query(Membership).filter_by(space_id=world["ideen"]).count() == 0
        assert db.query(TeamGrant).filter_by(space_id=world["ideen"]).count() == 0
    assert _setting("smtp_host") == "smtp.example.com" and _setting("suite_mail") is True
    assert world["ideen"] in [s["id"] for s in client.get("/api/spaces").json()], "the operator still sees it"


def _row_space(space_id: int) -> Space:
    with SessionLocal() as db:
        row = db.get(Space, space_id)
        assert row is not None
        db.expunge(row)
    return row


def test_what_nexsuite_keeps_cannot_be_changed_here(client: TestClient, operator: Account, world: dict,
                                                    fake: FakeSuite) -> None:
    connect(client, world, operator)
    with SessionLocal() as db:  # a space the app keeps itself (connecting hands the existing ones to nexsuite)
        row = Space(name="Only here")
        db.add(row)
        db.flush()
        db.add(Membership(space_id=row.id, account_id=operator.id, role="manage"))
        db.commit()
        own = row.id
    listing = client.get(f"/api/spaces/{own}/members").json()
    assert listing["suite"] is True and listing["managed"] is False, "a space of the app's own: rights stay here"
    assert client.get(f"/api/spaces/{world['studio']}/members").json()["managed"] is True
    for answer in (
        client.post("/api/teams", json={"name": "New"}),
        client.patch(f"/api/teams/{world['team']}", json={"name": "Renamed"}),
        client.post("/api/spaces", json={"name": "Another"}),
        client.patch(f"/api/spaces/{world['studio']}", json={"name": "Renamed"}),
        client.put(f"/api/spaces/{world['studio']}/members/ben", json={"role": "read"}),
        client.post("/api/invites", json={"days": 7}),
        client.post(f"/api/spaces/{own}/invites", json={"role": "read", "days": 7}),
        client.put("/api/me/profile", json={"display_name": "Me"}),
        client.put("/api/settings", json={"password_login": True}),
        client.delete("/api/oidc/config"),
    ):
        assert answer.status_code == 409 and answer.json()["detail"]["code"] == "managed_by_suite", answer.text


def test_only_the_emergency_account_signs_in_with_a_password(client: TestClient, operator: Account, world: dict,
                                                             fake: FakeSuite) -> None:
    connect(client, world, operator)
    with new_client() as stranger:
        assert stranger.post("/api/auth/login", json={"name": "ben", "password": PASSWORD}).status_code == 403
        assert stranger.post("/api/auth/login", json={"name": "tester", "password": PASSWORD}).status_code == 200


def _signed(token: str, payload: dict[str, Any], stamp: int | None = None) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload).encode()
    when = str(stamp if stamp is not None else int(time.time()))
    sig = hmac.new(token.encode(), when.encode() + b"." + body, hashlib.sha256).hexdigest()
    return body, {"X-Nexsuite-Time": when, "X-Nexsuite-Signature": sig, "Content-Type": "application/json"}


def test_a_notice_counts_only_signed_and_fresh(client: TestClient, operator: Account, world: dict,
                                               fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.people["2"]["display_name"] = "From the notice"
    with TestClient(client.app, base_url="http://testserver") as program:
        body, head = _signed("nxs_wrong", {"revision": 8, "kind": "changed"})
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 401
        body, head = _signed(fake.token, {"revision": 8, "kind": "changed"}, stamp=int(time.time()) - 3600)
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 401
        assert _row("anna").display_name != "From the notice"
        body, head = _signed(fake.token, {"revision": 8, "kind": "changed"})
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 204
    assert _row("anna").display_name == "From the notice"


def test_disconnecting_restores_the_own_sign_in_and_keeps_everything(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.people["60"] = {"id": "60", "name": "fritz", "display_name": "Fritz", "email": "", "operator": False,
                         "blocked": False}
    client.post("/api/suite/sync")
    assert client.post("/api/suite/disconnect", json={"current_password": "wrong"}).status_code == 401
    answer = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
    assert answer.status_code == 200 and "fritz" in answer.json()["without_password"]
    assert ("POST", "/leave") in fake.calls
    assert _setting("suite_state") == "" and _setting("oidc_issuer") == "" and _setting("password_login") is True
    with SessionLocal() as db:
        team = db.get(Team, world["team"])
        assert team is not None and team.source == "local" and team.external_id == ""
        assert db.query(TeamMember).filter_by(team_id=team.id).count() == 2
        assert db.get(Space, world["studio"]).external_id == ""  # type: ignore[union-attr]
    assert client.post("/api/teams", json={"name": "Free again"}).status_code == 201


def test_an_emergency_code_disconnects_without_nexsuite(client: TestClient, operator: Account, world: dict,
                                                        fake: FakeSuite) -> None:
    fake.emergency = [hashlib.sha256(b"WXYZ23456789").hexdigest()]
    connect(client, world, operator)
    wrong = client.post("/api/suite/emergency", json={"current_password": PASSWORD, "code": "AAAA-BBBB-CCCC"})
    assert wrong.status_code == 403
    fake.calls.clear()
    right = client.post("/api/suite/emergency", json={"current_password": PASSWORD, "code": "wxyz-2345-6789"})
    assert right.status_code == 200 and _setting("suite_state") == ""
    assert ("POST", "/leave") not in fake.calls


def test_when_nexsuite_forgot_the_app_it_runs_on_its_own(client: TestClient, operator: Account, world: dict,
                                                         fake: FakeSuite) -> None:
    connect(client, world, operator)
    fake.known = False
    client.post("/api/suite/sync")
    assert _setting("suite_state") == "" and _setting("password_login") is True


def test_a_disconnect_notice_from_nexsuite_is_followed(client: TestClient, operator: Account, world: dict,
                                                       fake: FakeSuite) -> None:
    connect(client, world, operator)
    body, head = _signed(fake.token, {"revision": 9, "kind": "disconnected"})
    with TestClient(client.app, base_url="http://testserver") as program:
        assert program.post("/api/suite/event", content=body, headers=head).status_code == 204
    assert _setting("suite_state") == ""
    assert ("POST", "/leave") not in fake.calls


def test_a_blocked_account_has_no_session_whatever_blocked_it(client: TestClient, operator: Account) -> None:
    from app.models import utcnow

    anna = make_account("anna")
    with new_client(anna) as browser:
        assert browser.get("/api/spaces").status_code == 200
        with SessionLocal() as db:
            row = db.get(Account, anna.id)
            assert row is not None
            row.blocked_at = utcnow()
            db.commit()
        assert browser.get("/api/spaces").status_code == 401


def test_without_a_mail_server_in_nexsuite_the_app_has_none_and_gets_its_own_back(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    client.put("/api/settings", json={"smtp_host": "own.example.com", "smtp_from": "boards@example.com"})
    connect(client, world, operator)
    assert _setting("smtp_host") == "" and _setting("suite_mail") is True
    assert client.get("/api/auth/me").json()["suite_mail"] is True
    refused = client.put("/api/settings", json={"smtp_host": "other.example.com"})
    assert refused.status_code == 409 and _setting("smtp_host") == ""
    assert client.post("/api/suite/disconnect", json={"current_password": PASSWORD}).status_code == 200
    assert _setting("smtp_host") == "own.example.com" and _setting("smtp_from") == "boards@example.com"

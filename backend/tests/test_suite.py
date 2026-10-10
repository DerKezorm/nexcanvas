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
from app.models import Account, AuthSession, Membership, OidcLink, OidcProvider, Space, Team, TeamGrant, TeamMember
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
        self.bin: list[dict[str, str]] = []
        self.pictures: dict[str, bytes] = {}
        #: The next request to this path fails once (nexsuite going away in the middle of connecting).
        self.fail_on = ""
        self.fetched: list[str] = []
        self.gone: list[str] = []
        self.calls: list[tuple[str, str]] = []
        self.next = 100
        #: nexsuite out of reach for every call (A11).
        self.down = False
        self.reports: list[dict[str, Any]] = []
        #: nexsuite refuses ``pair`` with this code (an older connection of the address, nexsuite 3ef5282).
        self.pair_refused = ""
        #: nexsuite refuses ``/people/{id}/name`` with this code.
        self.name_refused = ""

    def picture(self, url: str, token: str) -> bytes:
        assert token == self.token and url.startswith(SUITE + "/api/connect/v1/avatars/")
        pid = url.rsplit("/", 1)[1]
        self.fetched.append(pid)
        if pid not in self.pictures:
            raise suite.SuiteError("suite_failed", "nexsuite refused.", 409)
        return self.pictures[pid]

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
        if self.down:
            raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
        if path == "/pair":
            assert body["kind"] == "nexcanvas" and body["redirect_uri"].endswith("/api/oidc/callback")
            if self.pair_refused:
                raise suite.SuiteError(self.pair_refused, "nexsuite refused.", 409)
            if body["code"] != "GOOD-CODE-1234":
                raise suite.SuiteError("pair_code_invalid", "nexsuite refused.", 409)
            self.connected = False  # a new app in nexsuite, connecting
            return {"app_id": 1, "client_id": "nxs-client", "client_secret": "the-client-secret",
                    "token": self.token, "issuer": SUITE}
        if token != self.token or not self.known:
            raise suite.SuiteError("suite_refused", "nexsuite does not know this app any more.", 409)
        if self.connected and method == "POST" and (path in ("/people", "/teams", "/spaces", "/finish") or path.endswith(
                ("/email", "/name", "/join", "/tick"))):
            # As nexsuite's ``apps._connecting``: what an app brings while connecting, and ``finish``, only until then.
            raise suite.SuiteError("already_connected", "nexsuite refused.", 409)
        if path == "/directory":
            return {
                "revision": 7, "suite": {"name": "nexsuite", "url": SUITE},
                "people": list(self.people.values()), "teams": list(self.teams.values()),
                "spaces": [s for k, s in self.spaces.items() if k in self.ticked],
                "mail": self.seal(self.mail) if self.mail else None, "emergency": self.emergency,
                "bin": self.bin, "gone": self.gone,
                "candidates": [] if self.connected else [{"id": k, "name": s["name"], "color": s["color"]}
                                                         for k, s in self.spaces.items()],
            }
        if path == "/people":
            if self.fail_on == "/people":
                self.fail_on = ""
                raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
            pid = self._id()
            self.people[pid] = {"id": pid, "name": body["name"], "display_name": body["display_name"],
                                "email": body["email"], "operator": False, "blocked": False}
            return {"id": pid, "name": body["name"], "password": "mailed" if body["email"] else "in_suite"}
        if path.startswith("/people/") and path.endswith("/name"):
            if self.name_refused:
                raise suite.SuiteError(self.name_refused, "nexsuite refused.", 409)
            person = self.people[path.split("/")[2]]
            if person["display_name"]:
                return {"taken": False}
            person["display_name"] = body["display_name"]
            return {"taken": True}
        if path.startswith("/people/") and path.endswith("/email"):
            person = self.people[path.split("/")[2]]
            if person["email"]:
                return {"taken": False}
            person["email"] = body["email"]
            return {"taken": True}
        if path == "/teams":
            tid = self._id()
            self.teams[tid] = {"id": tid, "name": body["name"], "color": body["color"], "lead": body["lead"],
                               "members": body["members"]}
            return {"id": tid, "name": body["name"]}
        if path == "/spaces":
            if self.fail_on == "/spaces":
                self.fail_on = ""
                raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
            sid = self._id()
            self.spaces[sid] = {"id": sid, "name": body["name"], "color": body["color"] or "#f472b6",
                                "people": body["people"],
                                "teams": body["teams"]}
            self.ticked.add(sid)
            return {"id": sid, "name": body["name"]}
        if path.startswith("/spaces/") and path.endswith("/tick"):
            sid = path.split("/")[2]
            self.ticked.add(sid)
            rank = {"read": 1, "write": 2, "manage": 3}
            for key in ("people", "teams"):
                have = {g["id"]: g["role"] for g in self.spaces[sid][key]}
                for grant in (body or {}).get(key, []):
                    if rank[grant["role"]] > rank.get(have.get(grant["id"], ""), 0):
                        have[grant["id"]] = grant["role"]
                self.spaces[sid][key] = [{"id": k, "role": v} for k, v in have.items()]
            return None
        if path.startswith("/teams/") and path.endswith("/join"):
            tid = path.split("/")[2]
            team = self.teams[tid]
            team["members"] = sorted(set(team["members"]) | set(body["members"]), key=int)
            team["lead"] = team["lead"] or body["lead"]
            return {"id": tid, "name": team["name"]}
        if path == "/finish":
            if self.fail_on == "/finish":
                self.fail_on = ""
                raise suite.SuiteError("suite_unreachable", "nexsuite cannot be reached.")
            self.connected = True
            return None
        if path == "/report":
            self.reports.append(body)
            return None
        if path == "/leave":
            # nexsuite forgets the app; connecting again pairs a new one.
            self.connected = False
            return None
        raise AssertionError(path)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSuite]:
    played = FakeSuite()
    monkeypatch.setattr(suite, "request", played.handle)
    monkeypatch.setattr(suite, "picture", played.picture)
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
    # nexsuite is the coupled entry "oidc" of the provider list (blueprint 06); the settings of the one provider from
    # before the list stay as they were.
    with SessionLocal() as db:
        entry = db.query(OidcProvider).filter_by(slug="oidc").one()
        assert (entry.managed, entry.issuer, entry.client_id, entry.label) == ("nexsuite", SUITE, "nxs-client", "nexsuite")
        assert sorted((link.subject, link.account_id) for link in db.query(OidcLink).filter_by(provider_id=entry.id)) == sorted(
            (row.oidc_subject, row.id) for row in db.query(Account).filter(Account.oidc_subject != "")
            if row.blocked_at is None)
    # The settings of 0.3's one provider name nexsuite, as 0.3 wrote them: the way back finds the persons in
    # ``oidc_subject`` beside their own issuer.
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
    fake.spaces["10"]["color"] = "#123456"
    fake.ticked.add("10")
    client.post("/api/suite/sync")
    assert _row_space(world["ideen"]).color == "#123456", "the colour comes from nexsuite too"
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
        client.post("/api/oidc/oidc/link", json={"password": PASSWORD}),
    ):
        assert answer.status_code == 409 and answer.json()["detail"]["code"] == "managed_by_suite", answer.text


def test_connected_the_provider_list_changes_only_through_the_coupling(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    connect(client, world, operator)
    added = client.post("/api/oidc/admin/providers", json={"label": "x", "issuer": "https://x.example.com", "client_id": "x"})
    assert added.status_code == 422 and added.json()["detail"]["code"] == "provider_managed"
    listed = client.get("/api/oidc/admin/providers").json()
    assert [(item["slug"], item["managed"], item["editable"]) for item in listed] == [("oidc", "nexsuite", False)]


def test_only_the_emergency_account_signs_in_with_a_password(client: TestClient, operator: Account, world: dict,
                                                             fake: FakeSuite) -> None:
    connect(client, world, operator)
    with new_client() as stranger:
        # Ben signs in through nexsuite now: his old password is refused like a wrong one.
        assert stranger.post("/api/auth/login", json={"name": "ben", "password": PASSWORD}).status_code == 401
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
    # Connected: everybody signs in through nexsuite, only the emergency account (the operator) here.
    assert _row("anna").sign_in == "oidc" and _row("tester").sign_in == "password"
    assert client.get("/api/auth/me").json()["suite_emergency"] is True
    assert client.post("/api/suite/disconnect", json={"current_password": "wrong"}).status_code == 401
    answer = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
    assert answer.status_code == 200 and "fritz" in answer.json()["without_password"]
    assert _row("anna").sign_in == "password", "the own password holds again"
    assert client.get("/api/auth/me").json()["suite_emergency"] is False
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


def test_a_space_deleted_in_nexsuite_goes_into_the_bin_here_and_for_good_with_it(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    from datetime import timedelta

    from app.models import Board, utcnow

    connect(client, world, operator)
    with SessionLocal() as db:
        db.add(Board(id="board-in-ideen", space_id=world["ideen"], title="Sammlung"))
        db.commit()
    fake.ticked.discard("10")
    when = utcnow() - timedelta(days=3)
    fake.bin = [{"id": "10", "deleted_at": when.isoformat()}]
    client.post("/api/suite/sync")
    space = _row_space(world["ideen"])
    assert space.deleted_at is not None and abs((space.deleted_at - when).total_seconds()) < 1
    assert world["ideen"] not in [s["id"] for s in client.get("/api/spaces").json()], "gone for the operator too"
    # Brought back in nexsuite: back here, boards and all.
    fake.bin, fake.ticked = [], {"10"}
    client.post("/api/suite/sync")
    assert _row_space(world["ideen"]).deleted_at is None
    fake.ticked.discard("10")
    fake.gone = ["10"]
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        assert db.get(Space, world["ideen"]) is None
        assert db.query(Board).filter_by(title="Sammlung").count() == 0


def _picture(name: str) -> bytes | None:
    with SessionLocal() as db:
        return db.query(Account).filter_by(name=name).one().avatar


def test_the_profile_picture_comes_from_nexsuite_once_per_change(client: TestClient, operator: Account, world: dict,
                                                                  fake: FakeSuite) -> None:
    import io

    from PIL import Image

    connect(client, world, operator)
    png = io.BytesIO()
    Image.new("RGB", (30, 30), (10, 120, 200)).save(png, "PNG")
    fake.pictures["2"] = png.getvalue()
    fake.people["2"]["avatar"] = "2026-10-03T20:00:00.123456+00:00"
    client.post("/api/suite/sync")
    assert _picture("anna")[:4] == b"RIFF", "drawn anew as WebP"
    client.post("/api/suite/sync")
    assert fake.fetched == ["2"], "fetched once, not on every sync"
    fake.people["2"]["avatar"] = None
    client.post("/api/suite/sync")
    assert _picture("anna") is None
    # Set here no more: nexsuite keeps it.
    refused = client.put("/api/auth/avatar", content=png.getvalue())
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "managed_by_suite"
    assert client.delete("/api/auth/avatar").status_code == 409


def test_a_right_nexsuite_takes_away_closes_the_open_board_at_once(client: TestClient, operator: Account,
                                                                   world: dict, fake: FakeSuite) -> None:
    # The sync changes rights with bulk statements the commit hook does not see; it nudges the connections itself.
    from app.services import live

    from .test_live import Browser, cookie_of, make_board, wait_for

    connect(client, world, operator)
    client.post("/api/suite/sync")
    external = _row_space(world["studio"]).external_id
    board_id = make_board(client, world["studio"])
    with client.websocket_connect(f"/api/boards/{board_id}/live",
                                  headers={"cookie": cookie_of(world["anna"])}) as socket:
        Browser(socket).sync()
        fake.spaces[external]["people"], fake.spaces[external]["teams"] = [], []
        client.post("/api/suite/sync")
        room = live.room_of(board_id)
        wait_for(lambda: room is None or not room.peers, seconds=2.5)


def test_connected_no_operator_takes_another_accounts_password_or_second_factor(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, A5: an operator coming through nexsuite is never asked for a password here.
    connect(client, world, operator)
    anna = world["anna"]
    assert client.put(f"/api/accounts/{anna.id}/password",
                      json={"password": "a long new password", "current_password": PASSWORD}).status_code == 409
    reset = client.post(f"/api/accounts/{anna.id}/totp/reset", json={"current_password": PASSWORD})
    assert reset.status_code == 409 and reset.json()["detail"]["code"] == "managed_by_suite"
    # Anna, operator in nexsuite, comes through nexsuite: she may not disconnect from here, with any password.
    fake.people["2"]["operator"] = True
    client.post("/api/suite/sync")
    from .conftest import sign_in

    with new_client() as browser:
        sign_in(browser, anna)
        for path, body in (("/api/suite/disconnect", {"current_password": ""}),
                           ("/api/suite/emergency", {"current_password": "", "code": "WXYZ23456789"})):
            refused = browser.post(path, json=body)
            assert refused.status_code == 403 and refused.json()["detail"]["code"] == "disconnect_in_suite", path
        assert browser.put(f"/api/accounts/{operator.id}/password",
                           json={"password": "taking the keeper over", "current_password": ""}).status_code == 409
    assert _setting("suite_state") == "connected"
    assert client.get("/api/auth/me").json()["suite_emergency"] is True


def test_signing_out_everywhere_in_nexsuite_ends_the_sessions_here(client: TestClient, operator: Account,
                                                                    world: dict, fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, A6.
    from datetime import timedelta

    from app.models import utcnow

    from .conftest import sign_in

    connect(client, world, operator)
    with new_client() as before, new_client() as after:
        sign_in(before, world["anna"])
        assert before.get("/api/auth/me").status_code == 200
        fake.people["2"]["signed_out"] = (utcnow() + timedelta(seconds=1)).isoformat()
        import time

        time.sleep(1.2)
        sign_in(after, world["anna"])  # a session made after that moment stays
        client.post("/api/suite/sync")
        assert before.get("/api/auth/me").status_code == 401
        assert after.get("/api/auth/me").status_code == 200
    assert client.get("/api/auth/me").status_code == 200, "nobody else is signed out"



def test_no_person_space_or_team_is_matched_twice(client: TestClient, operator: Account, world: dict,
                                                  fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, A7: two accounts on one person let a blocked person still sign in.
    from .conftest import make_account

    twin = make_account("anna2")
    with SessionLocal() as db:
        db.get(Account, twin.id).email = "anna@example.com"  # type: ignore[union-attr]
        db.commit()
    client.post("/api/spaces", json={"name": "Ideen"})  # a second space named like nexsuite's Ideen
    found = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"}).json()
    suggested = {a["name"]: a["suggest"] for a in found["accounts"]}
    assert suggested["anna"] == "2" and suggested["anna2"] == "new", "each person is suggested once"
    assert sorted(s["suggest"] for s in found["spaces"] if s["name"].lower() == "ideen") == ["10", "keep"]
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    spaces = {s["id"]: s["suggest"] for s in found["spaces"]}
    for twice in ({**choices, twin.id: "2"}, choices):
        bad_spaces = spaces if twice is not choices else {k: "10" for k in spaces}
        refused = client.post("/api/suite/finish", json={"accounts": twice, "spaces": bad_spaces})
        assert refused.status_code == 422, refused.text
        assert refused.json()["detail"]["code"] in ("person_twice", "space_twice")
    assert _setting("suite_state") == "connecting", "nothing was applied"
    assert not any(call[1] in ("/people", "/teams", "/spaces") for call in fake.calls), "nothing reached nexsuite"


def test_a_matched_space_keeps_its_rights_and_a_matched_team_is_not_made_twice(
        client: TestClient, operator: Account, world: dict, fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, B1 and B2.
    from .conftest import join

    fake.teams["70"] = {"id": "70", "name": "design", "color": "#123456", "lead": None, "members": ["1"]}
    join(client, world["ideen"], "anna", "write")
    with SessionLocal() as db:  # a colour of its own, not the default
        db.get(Space, world["studio"]).color = "#0a7c5a"  # type: ignore[union-attr]
        db.commit()
    found = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"}).json()
    assert {t["name"]: t["suggest"] for t in found["teams"]} == {"Design": "70"}, "matched by name, any case"
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[world["cleo"].id] = "skip"
    spaces = {s["id"]: s["suggest"] for s in found["spaces"]}
    teams = {t["id"]: t["suggest"] for t in found["teams"]}
    assert client.post("/api/suite/finish", json={"accounts": choices, "spaces": spaces, "teams": teams}).status_code == 200
    assert list(fake.teams) == ["70"], "no second Design in nexsuite"
    ben = next(pid for pid, p in fake.people.items() if p["name"] == "ben")
    assert set(fake.teams["70"]["members"]) == {"1", "2", ben}, "the members here came along"
    assert fake.teams["70"]["lead"] == "2", "the team in nexsuite had no lead and takes anna"
    ideen = {g["id"]: g["role"] for g in fake.spaces["10"]["people"]}
    assert ideen["2"] == "write", "anna keeps her right in the matched space"
    assert ideen["1"] == "manage", "the higher right holds"
    studio = next(s for s in fake.spaces.values() if s["name"] == "Studio")
    assert studio["color"] == "#0a7c5a", "a new space keeps its colour (a2-9)"
    client.post("/api/suite/sync")
    with SessionLocal() as db:
        grants = {m.account_id: m.role for m in db.query(Membership).filter_by(space_id=world["ideen"])}
        assert grants[world["anna"].id] == "write", "and after the sync she still has it here"
        assert db.query(Team).count() == 1
    # Disconnect and connect again: the team is matched again, nothing doubles (it was 2, 4, 8, 16 before).
    assert client.post("/api/suite/disconnect", json={"current_password": PASSWORD}).status_code == 200
    fake.connected = False
    again = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"}).json()
    assert {t["name"]: t["suggest"] for t in again["teams"]} == {"design": "70"}
    choices = {a["id"]: a["suggest"] for a in again["accounts"]}
    done = client.post("/api/suite/finish", json={"accounts": choices,
                                                  "spaces": {s["id"]: s["suggest"] for s in again["spaces"]},
                                                  "teams": {t["id"]: t["suggest"] for t in again["teams"]}})
    assert done.status_code == 200, done.text
    assert list(fake.teams) == ["70"]
    with SessionLocal() as db:
        assert db.query(Team).count() == 1



def test_new_people_hear_how_they_get_a_password(client: TestClient, operator: Account, world: dict,
                                                 fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, B3: a person made new in nexsuite had no password, and nobody said so.
    found = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"}).json()
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    choices[world["cleo"].id] = "skip"
    with SessionLocal() as db:
        db.get(Account, world["ben"].id).email = "ben@example.com"  # type: ignore[union-attr]
        db.commit()
    done = client.post("/api/suite/finish", json={"accounts": choices,
                                                  "spaces": {s["id"]: s["suggest"] for s in found["spaces"]}})
    assert done.status_code == 200, done.text
    assert done.json()["new_people"] == [{"name": "ben", "password": "mailed"}]


def test_after_leaving_the_blocked_are_named_and_can_be_let_in_again(client: TestClient, operator: Account,
                                                                     world: dict, fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, B4: left out or blocked in nexsuite, an account stayed blocked for good after a disconnect.
    connect(client, world, operator)
    cleo = world["cleo"]
    assert client.post(f"/api/accounts/{cleo.id}/unblock", json={"current_password": PASSWORD}).status_code == 409
    gone = client.post("/api/suite/disconnect", json={"current_password": PASSWORD})
    assert gone.status_code == 200 and gone.json()["blocked"] == ["cleo"]
    listed = {a["name"]: a for a in client.get("/api/accounts").json()}
    assert listed["cleo"]["blocked"] is True
    assert client.post(f"/api/accounts/{cleo.id}/unblock", json={"current_password": "wrong"}).status_code == 401
    assert client.post(f"/api/accounts/{cleo.id}/unblock", json={"current_password": PASSWORD}).status_code == 204
    assert {a["name"]: a for a in client.get("/api/accounts").json()}["cleo"]["blocked"] is False
    with new_client() as stranger:
        assert stranger.post("/api/auth/login", json={"name": "cleo", "password": PASSWORD}).status_code == 200


def test_a_disconnect_waits_for_a_running_sync(client: TestClient, operator: Account, world: dict, fake: FakeSuite,
                                               monkeypatch: pytest.MonkeyPatch) -> None:
    # Prüfgang 04.10.2026, B5: a disconnect during the fetch of a sync brought the links back and doubled everything.
    import threading
    import time

    connect(client, world, operator)
    with SessionLocal() as db:
        accounts_before, spaces_before = db.query(Account).count(), db.query(Space).count()
    original, other = fake.handle, []

    def racing(method: str, url: str, *, token: str = "", body: Any = None) -> Any:
        answer = original(method, url, token=token, body=body)
        if url.endswith("/directory") and not other:
            def leave() -> None:
                with SessionLocal() as db:
                    suite.disconnect(db, tell=False)

            other.append(threading.Thread(target=leave))
            other[0].start()
            time.sleep(0.3)  # the disconnect is waiting for the lock now
        return answer

    monkeypatch.setattr(suite, "request", racing)
    with SessionLocal() as db:
        suite.sync(db)
    other[0].join(5)
    with SessionLocal() as db:
        assert settings_service.get(db, "suite_state") == ""
        assert db.query(Account).count() == accounts_before, "nobody made twice"
        assert db.query(Account).filter(Account.oidc_subject != "").count() == 0
        assert db.query(Space).count() == spaces_before
        assert db.query(Space).filter(Space.external_id != "").count() == 0


def test_connecting_again_after_a_failure_makes_nothing_twice(client: TestClient, operator: Account, world: dict,
                                                              fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, B6: a failed step left half a connection, and a retry made people, teams and spaces again.
    found = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"}).json()
    again = client.post("/api/suite/start", json={"url": SUITE + "/", "code": "GOOD-CODE-1234"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "connecting_already"
    choices = {a["id"]: a["suggest"] for a in found["accounts"]}
    spaces = {s["id"]: s["suggest"] for s in found["spaces"]}
    fake.fail_on = "/spaces"
    failed = client.post("/api/suite/finish", json={"accounts": choices, "spaces": spaces})
    assert failed.status_code >= 400 and _setting("suite_state") == "connecting"
    people, teams = len(fake.people), len(fake.teams)
    done = client.post("/api/suite/finish", json={"accounts": choices, "spaces": spaces})
    assert done.status_code == 200, done.text
    assert len(fake.people) == people and len(fake.teams) == teams, "what was made before is used, not made again"
    assert len([s for s in fake.spaces.values() if s["name"] == "Studio"]) == 1


def test_connected_an_old_invitation_is_no_way_in_through_nexsuite(client: TestClient, operator: Account,
                                                                   world: dict, fake: FakeSuite) -> None:
    # Prüfgang 04.10.2026, C9: the invitation page offers the provider now; connected, nexsuite is the only door.
    token = client.post("/api/invites", json={"days": 7}).json()["link"].rsplit("/", 1)[1]
    connect(client, world, operator)
    with new_client() as stranger:
        answer = stranger.get(f"/api/oidc/oidc/start?invite={token}", follow_redirects=False)
        assert answer.status_code in (302, 303) and "invite_invalid" in answer.headers["location"]

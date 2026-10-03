"""The operator sees and manages every space in the interface; members are told when it changes theirs; a program
with the operator's token has only the operator's own rights."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.models import Account
from app.services import apitokens

from .conftest import make_account, new_client


def test_the_operator_sees_and_changes_a_foreign_space(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    with new_client(anna) as browser:
        hers = browser.post("/api/spaces", json={"name": "Workshop"}).json()["id"]
        made = browser.post("/api/boards", json={"space_id": hers, "title": "Plan"}).json()["id"]
    listed = {s["id"]: s["role"] for s in client.get("/api/spaces").json()}
    assert listed[hers] == "manage"
    assert client.get(f"/api/boards/{made}").status_code == 200
    assert client.patch(f"/api/boards/{made}", json={"title": "Checked"}).status_code == 200


def test_members_are_told_when_the_operator_changes_their_space(client: TestClient, operator: Account) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    with new_client(anna) as browser:
        hers = browser.post("/api/spaces", json={"name": "Workshop"}).json()["id"]
    assert client.put(f"/api/spaces/{hers}/members/ben", json={"role": "read"}).status_code == 200
    with new_client(anna) as browser:
        assert [n["kind"] for n in browser.get("/api/notices").json()] == ["operator_added"]
    with new_client(ben) as browser:
        assert browser.get("/api/spaces").json()[0]["role"] == "read"


def test_the_operators_token_has_only_its_own_rights(client: TestClient, operator: Account) -> None:
    apitokens.forget()
    assert client.put("/api/settings", json={"api_tokens_allowed": True}).status_code == 200
    anna = make_account("anna")
    with new_client(anna) as browser:
        hers = browser.post("/api/spaces", json={"name": "Workshop"}).json()["id"]
    own = client.post("/api/spaces", json={"name": "Mine"}).json()["id"]
    secret = client.post("/api/api-tokens", json={"name": "nexdeck"}).json()["secret"]
    seen = {s["id"] for s in client.get("/api/v1/spaces", headers={"Authorization": f"Bearer {secret}"}).json()}
    assert own in seen and hers not in seen
    apitokens.forget()

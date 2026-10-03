"""Own templates (block 5): who keeps them where, who sees them, and that only a board's checked content is kept."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.models import Account

from .conftest import join, make_account, new_client

CONTENT = {
    "items": [
        {"id": "col-one", "kind": "frame", "x": 0, "y": 0, "w": 300, "h": 400, "title": "To do", "color": "#ff8a70"},
        {"id": "note-one", "kind": "note", "x": 20, "y": 40, "w": 180, "h": 180, "color": "yellow", "text": "First"},
        {"id": "evil-one", "kind": "script", "x": 0, "y": 0},
    ],
    "lines": [],
    "background": {"pattern": "grid", "color": "paper"},
    "onload": "alert(1)",
}


def keep(client: TestClient, space: int | None, name: str = "Weekly") -> dict:
    answer = client.post("/api/board-templates", json={"space": space, "name": name, "content": CONTENT})
    assert answer.status_code == 201, answer.text
    return answer.json()


def test_a_manager_keeps_a_template_its_readers_see_and_only_the_checked_content(client: TestClient,
                                                                                 operator: Account,
                                                                                 space: int) -> None:
    made = keep(client, space, "  Weekly   review ")
    assert made["name"] == "Weekly review"
    assert [i["id"] for i in made["content"]["items"]] == ["col-one", "note-one"]
    assert made["content"]["background"] == {"pattern": "grid", "color": "paper"}
    assert "onload" not in str(made)
    reader = make_account("reader")
    join(client, space, "reader", "read")
    with new_client(reader) as other:
        assert [t["key"] for t in other.get("/api/board-templates", params={"space": space}).json()] == [made["key"]]
        assert other.post("/api/board-templates", json={"space": space, "name": "x", "content": CONTENT}).status_code == 403
        assert other.put(f"/api/board-templates/{made['key']}", json={"name": "Mine"}).status_code == 403
        assert other.delete(f"/api/board-templates/{made['key']}").status_code == 403


def test_a_stranger_sees_neither_the_templates_nor_that_there_are_any(client: TestClient, operator: Account,
                                                                     space: int) -> None:
    made = keep(client, space)
    stranger = make_account("stranger")
    with new_client(stranger) as other:
        assert other.get("/api/board-templates", params={"space": space}).status_code == 404
        hidden = other.get(f"/api/board-templates/{made['key']}/file")
        missing = other.get("/api/board-templates/99999/file")
        assert hidden.status_code == missing.status_code == 404 and hidden.json() == missing.json()


def test_only_the_operator_keeps_templates_for_everybody(client: TestClient, operator: Account) -> None:
    member = make_account("member")
    with new_client(member) as other:
        assert other.post("/api/board-templates", json={"space": None, "name": "x", "content": CONTENT}).status_code == 403
    made = keep(client, None)
    with new_client(member) as other:
        assert [t["key"] for t in other.get("/api/board-templates").json()] == [made["key"]]


def test_renaming_passing_on_bringing_back_and_removing(client: TestClient, operator: Account, space: int) -> None:
    made = keep(client, space)
    assert client.put(f"/api/board-templates/{made['key']}", json={"name": "Retro"}).json()["name"] == "Retro"
    assert client.put(f"/api/board-templates/{made['key']}", json={"name": "\u0007"}).status_code == 422
    file = client.get(f"/api/board-templates/{made['key']}/file")
    assert file.headers["content-disposition"].startswith("attachment")
    passed = file.json()
    assert passed["format"] == "nexcanvas-template" and passed["name"] == "Retro"
    again = client.post("/api/board-templates", json={"space": space, "name": passed["name"], "content": passed["content"]})
    assert again.json()["content"]["items"] == made["content"]["items"]
    # A board made from it gets what the template holds.
    board = client.post("/api/boards", json={"space_id": space, "title": "From it", "content": passed["content"]}).json()
    assert client.get(f"/api/boards/{board['id']}").json()["picture"]["background"]["pattern"] == "grid"
    assert client.delete(f"/api/board-templates/{made['key']}").status_code == 204
    assert [t["key"] for t in client.get("/api/board-templates", params={"space": space}).json()] == [again.json()["key"]]

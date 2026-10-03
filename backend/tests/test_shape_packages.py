"""Shape packages (block 4): who installs where, who sees what, and that only the checked format is ever kept."""

from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.models import Account

from .conftest import join, make_account, new_client

ROUTER = {
    "id": "router",
    "name": {"en": "Router", "de": "Router"},
    "words": ["gateway"],
    "vw": 90,
    "vh": 56,
    "keep": True,
    "elements": [
        {"t": "path", "d": "M0 14A45 14 0 0 1 90 14V42A45 14 0 0 1 0 42Z", "f": "fill", "s": "line"},
        {"t": "ellipse", "cx": 45, "cy": 14, "rx": 45, "ry": 14},
        {"t": "line", "x1": 0, "y1": 0, "x2": 10, "y2": 10, "w": 2},
    ],
    "text": {"x": -0.4, "y": 1.04, "w": 1.8, "h": 0.42},
    "fill": "#60A5FA",
}
PACKAGE = {"name": {"en": "Home lab"}, "version": "1.2.0", "author": "Robin", "license": "CC0-1.0", "shapes": [ROUTER]}


def install(client: TestClient, space: int | None, package: dict | None = None) -> dict:
    answer = client.post("/api/shape-packages", json={"space": space, "package": package or PACKAGE})
    assert answer.status_code == 201, answer.text
    return answer.json()


def test_a_manager_installs_for_the_space_and_its_readers_see_it(client: TestClient, operator: Account, space: int) -> None:
    made = install(client, space)
    assert made["scope"] == "space" and made["id"] == f"p{made['key']}"
    assert made["shapes"][0]["fill"] == "#60a5fa"
    reader = make_account("reader")
    join(client, space, "reader", "read")
    with new_client(reader) as other:
        seen = other.get("/api/shape-packages", params={"space": space}).json()
        assert [p["key"] for p in seen] == [made["key"]]
        # Reading is not managing.
        assert other.post("/api/shape-packages", json={"space": space, "package": PACKAGE}).status_code == 403
        assert other.delete(f"/api/shape-packages/{made['key']}").status_code == 403


def test_a_stranger_sees_neither_the_packages_nor_that_there_are_any(client: TestClient, operator: Account,
                                                                   space: int) -> None:
    made = install(client, space)
    stranger = make_account("stranger")
    with new_client(stranger) as other:
        assert other.get("/api/shape-packages", params={"space": space}).status_code == 404
        assert other.get(f"/api/shape-packages/{made['key']}/file").status_code == 404
        assert other.put(f"/api/shape-packages/{made['key']}", json={"enabled": False}).status_code == 404
        missing = other.get("/api/shape-packages/99999/file")
        assert missing.status_code == 404 and missing.json() == other.get(f"/api/shape-packages/{made['key']}/file").json()


def test_only_the_operator_installs_for_the_whole_server_and_everybody_sees_those(client: TestClient,
                                                                                operator: Account) -> None:
    member = make_account("member")
    with new_client(member) as other:
        assert other.post("/api/shape-packages", json={"space": None, "package": PACKAGE}).status_code == 403
    made = install(client, None)
    assert made["scope"] == "server"
    with new_client(member) as other:
        assert [p["key"] for p in other.get("/api/shape-packages").json()] == [made["key"]]


def test_switching_off_replacing_passing_on_and_removing(client: TestClient, operator: Account, space: int) -> None:
    made = install(client, space)
    off = client.put(f"/api/shape-packages/{made['key']}", json={"enabled": False}).json()
    assert off["enabled"] is False
    bigger = copy.deepcopy(PACKAGE)
    bigger["shapes"].append({**ROUTER, "id": "switch", "name": {"en": "Switch"}})
    assert len(client.put(f"/api/shape-packages/{made['key']}", json={"package": bigger}).json()["shapes"]) == 2
    file = client.get(f"/api/shape-packages/{made['key']}/file")
    assert file.headers["content-disposition"].startswith("attachment")
    passed = file.json()
    assert passed["format"] == "nexcanvas-shapes"
    # The file comes back in as it went out.
    again = install(client, space, passed)
    assert [s["id"] for s in again["shapes"]] == ["router", "switch"]
    assert client.delete(f"/api/shape-packages/{made['key']}").status_code == 204
    assert [p["key"] for p in client.get("/api/shape-packages", params={"space": space}).json()] == [again["key"]]


def test_only_known_fields_are_kept(client: TestClient, operator: Account, space: int) -> None:
    sneaky = copy.deepcopy(PACKAGE)
    sneaky["script"] = "alert(1)"
    sneaky["shapes"][0]["onload"] = "alert(1)"
    sneaky["shapes"][0]["elements"][0]["style"] = "background:url(https://example.com/x)"
    sneaky["shapes"][0]["elements"][0]["href"] = "javascript:alert(1)"
    sneaky["shapes"][0]["word"] = " 1 "
    made = install(client, space, sneaky)
    assert made["shapes"][0]["word"] == "1"
    text = str(made)
    for word in ("script", "onload", "style", "href", "javascript", "example.com"):
        assert word not in text


@pytest.mark.parametrize(("where", "value"), [
    ("d", "M0 0L10 10<script>"),
    ("d", "M0 0 url(#x)"),
    ("f", "red"),
    ("f", "url(#gradient)"),
    ("t", "image"),
    ("t", "foreignObject"),
    ("w", 1e9),
    ("w", float("nan")),
    ("sx", 0),
    ("tx", "translate(10px)"),
])
def test_an_element_outside_the_format_is_refused(client: TestClient, operator: Account, space: int, where: str,
                                                  value: object) -> None:
    bad = copy.deepcopy(PACKAGE)
    bad["shapes"][0]["elements"][0][where] = value
    # Sent as the text a browser could send: Python's JSON writes NaN as a bare word, and Python's reader takes it.
    body = json.dumps({"space": space, "package": bad})
    answer = client.post("/api/shape-packages", content=body, headers={"content-type": "application/json"})
    assert answer.status_code == 422 and answer.json()["detail"]["code"] == "invalid_package"


@pytest.mark.parametrize("change", [
    {"id": "Router!"},
    {"name": {}},
    {"name": {"english": "Router"}},
    {"vw": 0},
    {"elements": []},
    {"fill": "rgb(1,2,3)"},
    {"outline": [{"x": 0, "y": 0}]},
    {"word": "x" * 41},
    {"word": "a\nb"},
    {"word": 3},
])
def test_a_shape_outside_the_format_is_refused(client: TestClient, operator: Account, space: int, change: dict) -> None:
    bad = copy.deepcopy(PACKAGE)
    bad["shapes"][0].update(change)
    assert client.post("/api/shape-packages", json={"space": space, "package": bad}).status_code == 422


def test_two_shapes_of_one_name_and_too_many_packages_are_refused(client: TestClient, operator: Account,
                                                                  space: int, monkeypatch: pytest.MonkeyPatch) -> None:
    twice = copy.deepcopy(PACKAGE)
    twice["shapes"].append(copy.deepcopy(ROUTER))
    assert client.post("/api/shape-packages", json={"space": space, "package": twice}).status_code == 422
    from app.services import shapepacks

    monkeypatch.setattr(shapepacks, "MAX_PER_SCOPE", 2)
    install(client, space)
    install(client, space)
    assert client.post("/api/shape-packages", json={"space": space, "package": PACKAGE}).status_code == 409


def test_the_library_remembers_favourites_and_recent_shapes_per_account(client: TestClient, operator: Account) -> None:
    saved = client.put("/api/me/preferences", json={"library_favorites": ["network/router", "p3/rack"], "library_open": False}).json()
    assert saved["library_favorites"] == ["network/router", "p3/rack"] and saved["library_open"] is False
    assert client.put("/api/me/preferences", json={"library_recent": ["<script>/x"]}).status_code == 422
    assert client.put("/api/me/preferences", json={"library_recent": ["a/b"] * 13}).status_code == 422


def test_an_account_switches_packages_off_for_its_own_library(client: TestClient, operator: Account) -> None:
    assert client.get("/api/auth/me").json()["preferences"]["library_hidden"] == []
    saved = client.put("/api/me/preferences", json={"library_hidden": ["room", "icons", "p3", "room"]}).json()
    assert saved["library_hidden"] == ["room", "icons", "p3"]
    assert client.get("/api/auth/me").json()["preferences"]["library_hidden"] == ["room", "icons", "p3"]
    for bad in (["network/router"], ["<b>"], "room", [1], ["x"] * 201):
        assert client.put("/api/me/preferences", json={"library_hidden": bad}).status_code == 422
    assert client.put("/api/me/preferences", json={"library_hidden": []}).json()["library_hidden"] == []


def test_a_board_carries_the_shapes_it_uses_checked(client: TestClient, operator: Account, space: int) -> None:
    content = {"items": [], "lines": [], "defs": {
        "p7/router": ROUTER,
        "p7/bad": {**ROUTER, "id": "bad", "elements": [{"t": "path", "d": "M0 0<script>"}]},
        "../../x": ROUTER,
    }}
    made = client.post("/api/boards", json={"space_id": space, "title": "Net", "content": content}).json()
    picture = client.get(f"/api/boards/{made['id']}").json()["picture"]
    assert list(picture["defs"]) == ["p7/router"]
    assert picture["defs"]["p7/router"]["elements"][0]["d"].startswith("M0 14")


"""API tokens and ``/api/v1``: programs read boards with the rights of the token's account, never more."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Account, ApiToken, Board, utcnow
from app.services import apitokens

from .conftest import join, make_account, new_client


@pytest.fixture(autouse=True)
def fresh_brake() -> Iterator[None]:
    apitokens.forget()
    yield
    apitokens.forget()


def switch_on(client: TestClient) -> None:
    assert client.put("/api/settings", json={"api_tokens_allowed": True}).status_code == 200


def make_token(client: TestClient, **body: object) -> str:
    answer = client.post("/api/api-tokens", json={"name": "nexdeck", **body})
    assert answer.status_code == 201, answer.text
    return str(answer.json()["secret"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def board(client: TestClient, space: int, title: str, items: list[dict] | None = None, **content: object) -> str:
    answer = client.post("/api/boards", json={"space_id": space, "title": title,
                                              "content": {"items": items or [], "lines": [], **content}})
    assert answer.status_code == 201, answer.text
    return str(answer.json()["id"])


NOTE = {"id": "note00001", "kind": "note", "x": 0, "y": 0, "w": 180, "h": 180, "color": "yellow", "text": "Hallo"}


def test_closed_until_the_operator_opens_it_and_never_for_a_web_page(client: TestClient, operator: Account) -> None:
    assert client.post("/api/api-tokens", json={"name": "x"}).json()["detail"]["code"] == "api_off"
    switch_on(client)
    token = make_token(client)
    assert token.startswith("nxa_")
    assert client.get("/api/v1/me", headers=bearer(token)).json()["name"] == "tester"
    assert client.get("/api/v1/me", headers={**bearer(token), "Origin": "https://example.com"}).status_code == 403
    assert client.put("/api/settings", json={"api_tokens_allowed": False}).status_code == 200
    assert client.get("/api/v1/me", headers=bearer(token)).json()["detail"]["code"] == "api_off"


def test_a_session_is_no_token_and_a_token_makes_no_tokens(client: TestClient, operator: Account) -> None:
    switch_on(client)
    token = make_token(client)
    # The browser's session counts for nothing under /api/v1.
    assert client.get("/api/v1/me").status_code == 401
    with TestClient(client.app, base_url="http://testserver", headers={"X-Nexcanvas-Client": "program-tab"}) as bare:
        assert bare.get("/api/api-tokens", headers=bearer(token)).status_code == 401
        assert bare.post("/api/api-tokens", headers=bearer(token), json={"name": "more"}).status_code == 401


def test_tokens_only_read(client: TestClient, operator: Account) -> None:
    switch_on(client)
    assert client.post("/api/api-tokens", json={"name": "n8n", "level": "write"}).status_code == 422
    assert client.get("/api/v1/me", headers=bearer(make_token(client))).json()["level"] == "read"


def test_a_token_sees_what_its_account_may_read_and_only_its_spaces(client: TestClient, operator: Account,
                                                                    space: int) -> None:
    switch_on(client)
    other = client.post("/api/spaces", json={"name": "Work"}).json()["id"]
    home_board = board(client, space, "Einkauf", [NOTE])
    work_board = board(client, other, "Projekt")
    everything = make_token(client)
    only_home = make_token(client, spaces=[space])
    names = {item["title"] for item in client.get("/api/v1/boards", headers=bearer(everything)).json()}
    assert names == {"Einkauf", "Projekt"}
    shown = client.get("/api/v1/boards", headers=bearer(only_home)).json()
    assert [item["title"] for item in shown] == ["Einkauf"]
    assert shown[0]["items"] == 1 and shown[0]["url"].endswith(f"/b/{home_board}")
    # Another space's board answers like one that does not exist, its picture too.
    missing = client.get("/api/v1/boards/nosuchboard1", headers=bearer(only_home)).json()
    for path in (f"/api/v1/boards/{work_board}", f"/api/v1/boards/{work_board}/picture.svg"):
        answer = client.get(path, headers=bearer(only_home))
        assert answer.status_code == 404 and answer.json() == missing
    assert client.get("/api/v1/boards", params={"space": other}, headers=bearer(only_home)).status_code == 404
    assert [item["name"] for item in client.get("/api/v1/spaces", headers=bearer(only_home)).json()] == ["Home"]
    # The own list names the spaces of a limited token.
    assert [item["spaces"] for item in client.get("/api/api-tokens").json()["tokens"]] == [None, ["Home"]]


def test_a_token_has_no_more_than_its_account(client: TestClient, operator: Account, space: int) -> None:
    switch_on(client)
    secret = board(client, space, "Geheim")
    rita = make_account("rita")
    with new_client(rita) as own:
        token = make_token(own)
        assert own.get("/api/v1/boards", headers=bearer(token)).json() == []
        assert own.get(f"/api/v1/boards/{secret}", headers=bearer(token)).status_code == 404
        # A space the account may not read cannot be chosen for a token.
        assert own.post("/api/api-tokens", json={"name": "x", "spaces": [space]}).status_code == 422
    join(client, space, "rita", "read")
    with new_client(rita) as own:
        assert [item["title"] for item in own.get("/api/v1/boards", headers=bearer(token)).json()] == ["Geheim"]


def test_run_out_blocked_or_deleted_tokens_answer_like_none(client: TestClient, operator: Account) -> None:
    switch_on(client)
    late = make_token(client, days=30)
    blocked = make_token(client)
    gone = make_token(client)
    with SessionLocal() as db:
        row = db.query(ApiToken).filter(ApiToken.token_hash == apitokens.digest(late)).one()
        row.expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    ids = {item["prefix"]: item["id"] for item in client.get("/api/api-tokens").json()["tokens"]}
    assert client.post(f"/api/admin/api-tokens/{ids[blocked[:8]]}/block").status_code == 200
    assert client.delete(f"/api/api-tokens/{ids[gone[:8]]}").status_code == 204
    for token in (late, blocked, gone, "nxa_" + "x" * 43, "not-a-token"):
        assert client.get("/api/v1/me", headers=bearer(token)).json()["detail"]["code"] == "token_invalid"
    assert client.post("/api/api-tokens", json={"name": "x", "days": 7}).status_code == 422


def test_a_token_slows_down_at_its_rate(client: TestClient, operator: Account, monkeypatch: pytest.MonkeyPatch) -> None:
    switch_on(client)
    token = make_token(client)
    monkeypatch.setattr(apitokens, "PER_MINUTE", 2)
    assert client.get("/api/v1/me", headers=bearer(token)).status_code == 200
    assert client.get("/api/v1/me", headers=bearer(token)).status_code == 200
    slow = client.get("/api/v1/me", headers=bearer(token))
    assert slow.status_code == 429 and slow.headers["retry-after"] == "60"


def test_the_numbers_for_a_dashboard(client: TestClient, operator: Account, space: int) -> None:
    switch_on(client)
    first = board(client, space, "Alt")
    board(client, space, "Neu", [NOTE])
    with SessionLocal() as db:
        row = db.get(Board, first)
        assert row is not None
        row.updated_at = utcnow() - timedelta(days=10)
        db.commit()
    numbers = client.get("/api/v1/dashboard", headers=bearer(make_token(client))).json()
    assert numbers["spaces"] == 1 and numbers["boards"] == 2
    assert numbers["changed_today"] == 1 and numbers["changed_week"] == 1
    assert [item["title"] for item in numbers["recent"]] == ["Neu", "Alt"]


ICON = {"id": "router", "name": {"en": "Router"}, "vw": 24, "vh": 24,
        "elements": [{"t": "rect", "x": 2, "y": 14, "width": 20, "height": 8, "f": "fill", "s": "line"}]}


def test_a_board_as_a_picture_holds_nothing_that_runs(client: TestClient, operator: Account, space: int) -> None:
    switch_on(client)
    token = make_token(client)
    made = board(client, space, "Plan <&> \"x\"", [
        NOTE,
        {"id": "star00001", "kind": "shape", "x": 300, "y": 0, "w": 120, "h": 120, "shape": "star", "fill": "#fbbf24",
         "stroke": "none", "text": ""},
        {"id": "icon00001", "kind": "shape", "x": 500, "y": 0, "w": 64, "h": 64, "shape": "rect",
         "lib": "icons-devices/router", "fill": "#3b82f6", "stroke": "none", "text": ""},
        {"id": "flow00001", "kind": "shape", "x": 0, "y": 300, "w": 140, "h": 90, "shape": "rect", "lib": "flow/decision",
         "fill": "#fde68a", "stroke": "none", "text": ""},
        {"id": "evil00001", "kind": "shape", "x": 0, "y": 500, "w": 10, "h": 10, "shape": "<script>",
         "fill": "\"/><script>alert(1)</script>", "stroke": "url(javascript:alert(1))", "text": ""},
    ], defs={"icons-devices/router": ICON}, background={"pattern": "grid", "color": "paper"})
    answer = client.get(f"/api/v1/boards/{made}/picture.svg", params={"look": "light", "width": 320},
                        headers=bearer(token))
    assert answer.status_code == 200
    assert answer.headers["content-type"].startswith("image/svg+xml")
    assert "default-src 'none'" in answer.headers["content-security-policy"]
    text = answer.text
    assert text.startswith('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"')
    assert "<title>Plan &lt;&amp;&gt; \"x\"</title>" in text
    assert 'fill="#ffffff"' in text  # the paper background
    assert 'fill="#fde68a"' in text  # the note
    assert 'd="M70 0L140 45L70 90L0 45Z"' in text  # the decision, drawn as the flowchart package draws it
    assert text.count('<path transform="translate(300 0)"') == 1  # the star, one of the board's own shapes
    assert 'fill="#3b82f6"' in text  # the icon the board carries
    for bad in ("<script", "javascript", "alert"):
        assert bad not in text
    empty = board(client, space, "Leer")
    blank = client.get(f"/api/v1/boards/{empty}/picture.svg", headers=bearer(token)).text
    assert blank.count("<rect") == 1 and 'fill="#111117"' in blank


def test_a_blocked_account_reads_nothing_with_its_token(client: TestClient, operator: Account) -> None:
    switch_on(client)
    anna = make_account("anna")
    with new_client() as browser:
        from .conftest import sign_in

        sign_in(browser, anna)
        token = make_token(browser)
    with new_client() as program:
        assert program.get("/api/v1/me", headers=bearer(token)).status_code == 200
        with SessionLocal() as db:  # blocked here or in nexsuite (Prüfgang 04.10.2026, A4)
            db.get(Account, anna.id).blocked_at = utcnow()  # type: ignore[union-attr]
            db.commit()
        assert program.get("/api/v1/me", headers=bearer(token)).status_code == 401
        assert program.get("/api/v1/boards", headers=bearer(token)).status_code == 401

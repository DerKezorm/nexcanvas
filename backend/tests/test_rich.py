"""Formatting inside the words: kept through copies, versions, readers and JSON Canvas; only what the board knows."""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient
from pycrdt import Doc, Map, Text

from app.db import SessionLocal
from app.models import Account, Board
from app.services import boards, rich

from .conftest import join, make_account
from .test_live import Browser, cookie_of, make_board

#: "Lösung" bold, "Schritt eins" and "Schritt zwei" a bulleted list, "rot" red and large.
RUNS: list[dict[str, Any]] = [
    {"insert": "Lösung", "attributes": {"bold": True}},
    {"insert": " heute\nSchritt eins"},
    {"insert": "\n", "attributes": {"list": "bullet"}},
    {"insert": "Schritt zwei"},
    {"insert": "\n", "attributes": {"list": "bullet"}},
    {"insert": "rot", "attributes": {"color": "#f87171", "size": "large", "italic": True}},
]
WORDS = rich.plain_of(RUNS)


def lesson(more: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"items": [
        {"id": "note0001", "kind": "note", "x": 0, "y": 0, "w": 200, "h": 200, "color": "yellow", "text": WORDS,
         "rich": RUNS, **(more or {})},
        {"id": "note0002", "kind": "note", "x": 300, "y": 0, "w": 200, "h": 200, "color": "blue", "text": "schlicht"},
    ], "lines": []}


def picture_of(client: TestClient, board_id: str) -> dict[str, Any]:
    return {item["id"]: item for item in client.get(f"/api/boards/{board_id}").json()["picture"]["items"]}


def test_only_what_the_board_knows_is_kept() -> None:
    runs = rich.clean_runs([
        {"insert": "a", "attributes": {"bold": True, "link": "javascript:alert(1)", "font": "serif"}},
        {"insert": "b", "attributes": {"color": "#F87171", "size": "large"}},
        {"insert": "c", "attributes": {"color": "red;x:url(y)", "size": "99px", "italic": "yes", "list": "checked"}},
        {"insert": {"video": "javascript:alert(1)"}},
        {"insert": ""},
        "rubbish",
        {"insert": "\n", "attributes": {"list": "ordered"}},
    ])
    assert runs == [
        {"insert": "a", "attributes": {"bold": True}},
        {"insert": "b", "attributes": {"color": "#f87171", "size": "large"}},
        {"insert": "c"},
        {"insert": "\n", "attributes": {"list": "ordered"}},
    ]


def test_a_new_board_keeps_the_formatting_and_plain_words_stay_plain(client: TestClient, operator: Account,
                                                                    space: int) -> None:
    items = picture_of(client, make_board(client, space, content=lesson()))
    assert items["note0001"]["text"] == WORDS
    assert items["note0001"]["rich"] == RUNS
    assert "rich" not in items["note0002"]
    # The formatting lives in the words, never as a field of the item.
    with SessionLocal() as db:
        board = db.query(Board).first()
        assert board is not None
        stored = boards.load(db, board).get("items", type=Map).to_py() or {}
        assert all("rich" not in value for value in stored.values())


def test_formatting_for_other_words_is_none(client: TestClient, operator: Account, space: int) -> None:
    # A template made into a skeleton empties the words; formatting left behind must not bring them back.
    items = picture_of(client, make_board(client, space, content=lesson({"text": ""})))
    assert items["note0001"]["text"] == "" and "rich" not in items["note0001"]
    items = picture_of(client, make_board(client, space, content=lesson({"text": "anders"})))
    assert items["note0001"]["text"] == "anders" and "rich" not in items["note0001"]


def test_a_copy_keeps_the_formatting(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    copy = client.post(f"/api/boards/{board_id}/copy", json={"title": "Kopie"}).json()
    assert {item["id"]: item for item in copy["picture"]["items"]}["note0001"]["rich"] == RUNS


def test_bringing_a_version_back_brings_the_formatting_back(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    with SessionLocal() as db:
        board = db.get(Board, board_id)
        assert board is not None
        boards.fold(db, board_id, boards.load(db, board), {"tester"})
        # Someone takes the bold away afterwards: the words stay the same, only the formatting changes.
        doc = boards.load(db, board)
        before = doc.get_state()
        words = doc.get("texts", type=Map)["note0001"]
        assert isinstance(words, Text)
        words.format(0, len(words), {"bold": None, "list": None, "color": None, "size": None, "italic": None})
        boards.store_update(db, board_id, doc.get_update(before), "tester")
    assert "rich" not in stored(board_id)["note0001"]
    version = client.get(f"/api/boards/{board_id}/versions").json()[0]["id"]
    assert client.post(f"/api/boards/{board_id}/versions/{version}/restore").status_code == 200
    assert stored(board_id)["note0001"]["rich"] == RUNS


def stored(board_id: str) -> dict[str, Any]:
    """The board's items as its document holds them now."""
    with SessionLocal() as db:
        board = db.get(Board, board_id)
        assert board is not None
        return {item["id"]: item for item in boards.snapshot_of(boards.load(db, board))["items"]}


def test_a_reader_gets_the_words_with_their_formatting(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    rita = make_account("rita")
    join(client, space, "rita", "read")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        teacher, pupil = Browser(one), Browser(two)
        teacher.sync()
        pupil.sync()
        words = pupil.texts["note0001"]
        assert isinstance(words, Text)
        assert rich.runs_of(words) == RUNS
        # The teacher makes "heute" underlined: the pupil gets it too (pycrdt counts in bytes of UTF-8).
        before = teacher.doc.get_state()
        mine = teacher.texts["note0001"]
        assert isinstance(mine, Text)
        start = len("Lösung ".encode())
        mine.format(start, start + len("heute"), {"underline": True})
        one.send_bytes(_update(teacher.doc.get_update(before)))
        pupil.receive_update()
        words = pupil.texts["note0001"]
        assert isinstance(words, Text)
        assert {"insert": "heute", "attributes": {"underline": True}} in rich.runs_of(words)


def _update(update: bytes) -> bytes:
    from pycrdt import create_update_message

    return create_update_message(update)


def test_json_canvas_gets_markdown_and_another_nexcanvas_the_formatting(client: TestClient, operator: Account,
                                                                         space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    exported = client.get(f"/api/boards/{board_id}/export").content
    canvas = json.loads(exported)
    node = next(node for node in canvas["nodes"] if node["id"] == "note0001")
    # Obsidian and nexlore read Markdown: bold, lists, italic. Colour and size have none.
    assert node["text"] == "**Lösung** heute\n- Schritt eins\n- Schritt zwei\n*rot*"
    assert node["nexcanvas"]["rich"] == RUNS
    # Into another nexcanvas: the words as they were, with all their formatting.
    other = client.post("/api/spaces", json={"name": "Elsewhere"}).json()["id"]
    answer = client.post("/api/boards/from-file", params={"space_id": other, "name": "a.canvas"}, content=exported)
    assert answer.status_code == 201, answer.text
    items = picture_of(client, answer.json()["board"]["id"])
    note = next(item for item in items.values() if item.get("color") == "yellow")
    assert note["text"] == WORDS and note["rich"] == RUNS


def test_markdown_of_formatted_words() -> None:
    assert rich.markdown([{"insert": "a "}, {"insert": "b", "attributes": {"underline": True, "strike": True}}]) == \
        "a ~~<u>b</u>~~"
    # Marks hug the words, spaces stay outside; numbered lists count from one after other lines.
    assert rich.markdown([{"insert": " fett ", "attributes": {"bold": True}}]) == " **fett** "
    assert rich.markdown([
        {"insert": "x"}, {"insert": "\n", "attributes": {"list": "ordered"}},
        {"insert": "y"}, {"insert": "\n", "attributes": {"list": "ordered"}},
        {"insert": "z\nw"}, {"insert": "\n", "attributes": {"list": "ordered"}},
    ]) == "1. x\n2. y\nz\n1. w"


def test_filling_a_text_gives_each_run_its_own_formatting_only() -> None:
    doc = Doc()
    texts = doc.get("texts", type=Map)
    with doc.transaction():
        rich.put(texts, "a", WORDS, RUNS)
        rich.put(texts, "b", "plain", None)
    assert rich.runs_of(texts["a"]) == RUNS
    assert str(texts["b"]) == "plain" and rich.rich_of(texts["b"]) is None

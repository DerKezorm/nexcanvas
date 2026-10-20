"""Frames whose content is hidden: who may only read never gets it, live or otherwise; who may write has it."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import Doc, Map, Text, create_sync_message
from starlette.websockets import WebSocketDisconnect

from app.db import SessionLocal
from app.models import Account
from app.services import hiding, live, settings_service

from .conftest import join, make_account, new_client
from .test_live import Browser, cookie_of, make_board, wait_for

CASES = json.loads((Path(__file__).parent / "hiding_cases.json").read_text(encoding="utf-8"))["cases"]
SECRET = "Antwort zweiundvierzig"


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_rule_of_what_a_frame_hides(case: dict[str, Any]) -> None:
    hidden = hiding.hidden_ids(case["items"])
    assert sorted(hidden) == case["hidden"]
    frames = hiding.hiding_frames(case["items"])
    assert sorted(line["id"] for line in case["lines"] if hiding.hidden_line(line, hidden, frames)) == case["hiddenLines"]
    shown = hiding.visible({"items": case["items"], "lines": case["lines"]})
    assert {item["id"] for item in shown["items"]} == {item["id"] for item in case["items"]} - set(case["hidden"])


def lesson(hidden: bool = True) -> dict[str, Any]:
    return {"items": [
        {"id": "frame001", "kind": "frame", "x": 0, "y": 0, "w": 400, "h": 300, "title": "Lösung", "color": "#ff8a70",
         **({"hidden": True, "hiddenBy": 1} if hidden else {})},
        {"id": "answer01", "kind": "note", "x": 50, "y": 50, "w": 100, "h": 100, "color": "yellow", "text": SECRET},
        {"id": "question", "kind": "note", "x": 600, "y": 50, "w": 100, "h": 100, "color": "pink", "text": "Frage"},
    ], "lines": [
        {"id": "line0001", "kind": "line", "a": {"item": "question", "x": 0, "y": 0},
         "b": {"item": "answer01", "x": 0, "y": 0}, "color": "auto", "width": 2, "arrow": "end", "curve": True},
    ]}


def everything_of(browser: Browser) -> bytes:
    """All a browser holds of the board, as bytes: what is not in here, it never had (or no longer has)."""
    return browser.doc.get_update()


def test_a_reader_gets_the_board_live_without_what_is_hidden(client: TestClient, operator: Account,
                                                              space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    rita = make_account("rita")
    join(client, space, "rita", "read")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        teacher, pupil = Browser(one), Browser(two)
        teacher.sync()
        pupil.sync()
        assert set(teacher.items.to_py()) == {"frame001", "answer01", "question"}
        assert set(pupil.items.to_py()) == {"frame001", "question"}
        assert pupil.items.to_py()["frame001"]["hidden"] is True
        assert str(pupil.texts["question"]) == "Frage" and "answer01" not in pupil.texts
        assert pupil.doc.get("lines", type=Map).to_py() == {}
        assert SECRET.encode() not in everything_of(pupil)

        # The teacher writes in the hidden note and moves the question: the pupil gets the move, never the words.
        before = teacher.doc.get_state()
        with teacher.doc.transaction():
            words = teacher.texts["answer01"]
            assert isinstance(words, Text)
            words += " und mehr"
            teacher.items["question"] = {**teacher.items.to_py()["question"], "x": 650}
        one.send_bytes(_update(teacher.doc.get_update(before)))
        pupil.receive_update()
        assert pupil.items.to_py()["question"]["x"] == 650
        assert b"und mehr" not in everything_of(pupil) and SECRET.encode() not in everything_of(pupil)

        # Shown: now it comes, with its words and its line.
        teacher.change("frame001", {k: v for k, v in teacher.items.to_py()["frame001"].items() if k != "hidden"})
        pupil.receive_update()
        assert "answer01" in pupil.items.to_py()
        assert str(pupil.texts["answer01"]) == SECRET + " und mehr"
        assert set(pupil.doc.get("lines", type=Map).to_py()) == {"line0001"}

        # Hidden again: it goes from the pupil's board.
        teacher.change("frame001", {**teacher.items.to_py()["frame001"], "hidden": True})
        pupil.receive_update()
        assert set(pupil.items.to_py()) == {"frame001", "question"}
        assert "answer01" not in pupil.texts

    # A reader who comes now gets nothing of it either, not even what was deleted from the readers' document.
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        Browser(one).sync()
        later = Browser(two)
        later.sync()
        assert set(later.items.to_py()) == {"frame001", "question"}
        assert SECRET.encode() not in everything_of(later)


def test_a_reader_alone_in_a_room_that_hid_something_gets_nothing_of_it(client: TestClient, operator: Account,
                                                                         space: int) -> None:
    board_id = make_board(client, space, content=lesson(hidden=False))
    rita = make_account("rita")
    join(client, space, "rita", "read")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one:
        teacher = Browser(one)
        teacher.sync()
        teacher.change("frame001", {**teacher.items.to_py()["frame001"], "hidden": True})
        room = live.room_of(board_id)
        wait_for(lambda: room is not None and room.doc.get("items", type=Map).to_py()["frame001"].get("hidden"))
        # The first reader comes after the change: the readers' document is made then, without the answer.
        with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
            pupil = Browser(two)
            pupil.sync()
            assert set(pupil.items.to_py()) == {"frame001", "question"}
            assert SECRET.encode() not in everything_of(pupil)


def test_what_a_reader_asks_the_server_for_is_never_more_than_its_view(client: TestClient, operator: Account,
                                                                      space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    rita = make_account("rita")
    join(client, space, "rita", "read")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        # The server opens with the state of the readers' document, not of the whole one.
        first = two.receive_bytes()
        room = live.room_of(board_id)
        assert room is not None and room.reader is not None
        assert first == create_sync_message(room.reader) != create_sync_message(room.doc)
        # A forged step 1 with an empty state asks for everything: it still gets the readers' document only.
        two.send_bytes(create_sync_message(Doc()))
        answer = two.receive_bytes()
        assert SECRET.encode() not in answer


def test_a_reader_who_may_now_write_starts_again_with_the_whole_board(client: TestClient, operator: Account,
                                                                     space: int, monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = make_board(client, space, content=lesson())
    rita = make_account("rita")
    join(client, space, "rita", "read")
    monkeypatch.setattr(live, "RECHECK_SECONDS", 0)
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        Browser(two).sync()
        join(client, space, "rita", "write")
        room = live.room_of(board_id)
        assert room is not None
        wait_for(lambda: not any(peer.name == "rita" for peer in room.peers))
        with pytest.raises(WebSocketDisconnect) as closed:
            two.receive_bytes()
        assert closed.value.code == live.CLOSE_RECONNECT
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(rita)}) as two:
        writer = Browser(two)
        writer.sync()
        assert "answer01" in writer.items.to_py()


def test_who_may_only_read_gets_no_hidden_content_by_any_other_way(client: TestClient, operator: Account,
                                                                    space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    rita = make_account("rita")
    join(client, space, "rita", "read")
    with new_client(rita) as reader:
        picture = reader.get(f"/api/boards/{board_id}").json()["picture"]
        assert [item["id"] for item in picture["items"]] == ["frame001", "question"] and picture["lines"] == []
        listed = next(board for board in reader.get("/api/boards").json() if board["id"] == board_id)
        assert SECRET not in json.dumps(listed)
        assert SECRET.encode() not in reader.get(f"/api/boards/{board_id}/export").content
        assert reader.get("/api/search", params={"q": "zweiundvierzig"}).json() == []
        assert reader.get("/api/search", params={"q": "frage"}).json()[0]["id"] == board_id
    # Who may write has it; the search finds hidden words for nobody (it would tell a reader they are there).
    picture = client.get(f"/api/boards/{board_id}").json()["picture"]
    assert "answer01" in {item["id"] for item in picture["items"]}
    assert SECRET.encode() in client.get(f"/api/boards/{board_id}/export").content
    assert client.get("/api/search", params={"q": "zweiundvierzig"}).json() == []


def test_a_public_page_shows_no_hidden_content_nor_its_files(client: TestClient, operator: Account,
                                                             space: int) -> None:
    board_id = make_board(client, space, content=lesson())
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
    answer = client.put(f"/api/boards/{board_id}/share", json={})
    assert answer.status_code == 200, answer.text
    token = answer.json()["link"].rsplit("/", 1)[1]
    with new_client() as stranger:
        page = stranger.get(f"/api/public/{token}").json()
        assert [item["id"] for item in page["picture"]["items"]] == ["frame001", "question"]
        assert SECRET not in json.dumps(page)


def _update(update: bytes) -> bytes:
    from pycrdt import create_update_message

    return create_update_message(update)

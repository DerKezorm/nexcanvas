"""Working on a board together: the y-websocket protocol between browsers and the server, with rights.

The browsers here are pycrdt documents speaking the same messages Yjs sends (sync step 1 and 2, updates).
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import (
    Doc,
    Map,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Account, Board, BoardUpdate
from app.security import SESSION_COOKIE, start_session
from app.services import boards, live

from .conftest import join, make_account, new_client


def cookie_of(account: Account) -> str:
    with SessionLocal() as db:
        row = db.get(Account, account.id)
        assert row is not None
        return f"{SESSION_COOKIE}={start_session(db, row, '127.0.0.1', 'tests')}"


def make_board(client: TestClient, space: int, title: str = "Plan", content: dict | None = None) -> str:
    answer = client.post("/api/boards", json={"space_id": space, "title": title, "content": content})
    assert answer.status_code == 201, answer.text
    return str(answer.json()["id"])


class Browser:
    """One tab with a board open: a Yjs document kept in step with the server over the socket."""

    def __init__(self, socket: Any) -> None:
        self.socket = socket
        self.doc = Doc()
        self.items = self.doc.get("items", type=Map)
        self.doc.get("lines", type=Map)
        self.texts = self.doc.get("texts", type=Map)
        self._sent: list[bytes] = []

    def sync(self) -> None:
        """Answer the server's step 1, send our own, and take its step 2 (as y-websocket does on connect)."""
        first = self.socket.receive_bytes()
        assert first[0] == YMessageType.SYNC
        reply = handle_sync_message(first[1:], self.doc)
        assert reply is not None
        self.socket.send_bytes(reply)
        self.socket.send_bytes(create_sync_message(self.doc))
        answer = self.socket.receive_bytes()
        assert answer[0] == YMessageType.SYNC and answer[1] == YSyncMessageType.SYNC_STEP2
        handle_sync_message(answer[1:], self.doc)

    def change(self, key: str, value: dict[str, Any]) -> None:
        before = self.doc.get_state()
        self.items[key] = value
        self.socket.send_bytes(create_update_message(self.doc.get_update(before)))

    def receive_update(self) -> None:
        message = self.socket.receive_bytes()
        assert message[0] == YMessageType.SYNC, message[:2]
        handle_sync_message(message[1:], self.doc)


def wait_for(condition: Any, seconds: float = 3.0) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


def stored_updates(board_id: str) -> int:
    with SessionLocal() as db:
        return int(db.scalar(select(func.count()).select_from(BoardUpdate).where(BoardUpdate.board_id == board_id)))


def test_two_browsers_see_each_others_changes_and_the_server_keeps_them(client: TestClient, operator: Account,
                                                                        space: int) -> None:
    board_id = make_board(client, space)
    anna = make_account("anna")
    join(client, space, "anna", "write")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(anna)}) as two:
        first, second = Browser(one), Browser(two)
        first.sync()
        second.sync()
        first.change("note-1", {"kind": "note", "x": 10, "y": 20, "w": 180, "h": 180, "color": "yellow",
                                "text": "Milch", "z": 1})
        second.receive_update()
        assert second.items.to_py()["note-1"]["text"] == "Milch"
        wait_for(lambda: stored_updates(board_id) == 1)
        second.change("note-2", {"kind": "note", "x": 300, "y": 20, "w": 180, "h": 180, "color": "pink",
                                 "text": "Brot", "z": 2})
        first.receive_update()
        assert set(first.items.to_py()) == {"note-1", "note-2"}
    # Everyone left: the room folded the updates into the board, and its picture says what is on it.
    wait_for(lambda: stored_updates(board_id) == 0)
    picture = client.get(f"/api/boards/{board_id}").json()["picture"]
    assert [item["text"] for item in picture["items"]] == ["Milch", "Brot"]
    assert client.get("/api/search", params={"q": "brot"}).json()[0]["id"] == board_id


def test_a_newcomer_gets_the_whole_board(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space, content={"items": [
        {"id": "start-note", "kind": "note", "x": 0, "y": 0, "w": 100, "h": 100, "color": "blue", "text": "Hi"},
    ], "lines": []})
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one:
        browser = Browser(one)
        browser.sync()
        # The words travel as a shared text of their own, next to the item.
        assert "text" not in browser.items.to_py()["start-note"]
        assert browser.texts.to_py()["start-note"] == "Hi"


def test_a_reader_follows_along_but_its_changes_are_dropped(client: TestClient, operator: Account,
                                                            space: int) -> None:
    board_id = make_board(client, space)
    reader = make_account("rita")
    join(client, space, "rita", "read")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(reader)}) as two:
        writer, looker = Browser(one), Browser(two)
        writer.sync()
        looker.sync()
        # A forged change from the reader: neither stored nor passed on.
        looker.change("forged", {"kind": "note", "x": 0, "y": 0, "w": 1, "h": 1, "color": "gray", "text": "no"})
        writer.change("real", {"kind": "note", "x": 0, "y": 0, "w": 1, "h": 1, "color": "gray", "text": "yes"})
        looker.receive_update()
        assert "real" in looker.items.to_py()
        wait_for(lambda: stored_updates(board_id) == 1)
        room = live.room_of(board_id)
        assert room is not None and "forged" not in room.doc.get("items", type=Map).to_py()
        assert "forged" not in writer.items.to_py()


def test_nobody_without_a_right_gets_in(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space)
    stranger = make_account("sam")
    for cookie in (cookie_of(stranger), ""):
        with pytest.raises(Exception), client.websocket_connect(  # noqa: B017 - the socket is refused, by close code
            f"/api/boards/{board_id}/live", headers={"cookie": cookie}
        ) as socket:
            socket.receive_bytes()


def test_another_site_cannot_open_the_connection(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space)
    headers = {"cookie": cookie_of(operator), "origin": "https://evil.example.com"}
    with pytest.raises(Exception), client.websocket_connect(  # noqa: B017
        f"/api/boards/{board_id}/live", headers=headers
    ) as socket:
        socket.receive_bytes()
    same = {"cookie": cookie_of(operator), "origin": "http://testserver"}
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers=same) as socket:
        assert socket.receive_bytes()[0] == YMessageType.SYNC


def test_a_board_in_the_bin_closes_its_connections(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space)
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one:
        Browser(one).sync()
        assert client.delete(f"/api/boards/{board_id}").status_code == 204
        with pytest.raises(Exception):  # noqa: B017 - closed by the server
            one.receive_bytes()
    assert client.get(f"/api/boards/{board_id}").status_code == 404


def test_updates_left_by_a_crash_are_folded_at_the_start(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space)
    doc = boards.empty_doc()
    before = doc.get_state()
    doc.get("items", type=Map)["late"] = {"kind": "text", "x": 0, "y": 0, "w": 100, "h": 30, "text": "after crash"}
    with SessionLocal() as db:
        boards.store_update(db, board_id, doc.get_update(before), "tester")
        assert boards.fold_leftovers(db) == 1
        board = db.get(Board, board_id)
        assert board is not None and board.item_count == 1
    assert stored_updates(board_id) == 0


def test_an_oversized_change_is_refused(client: TestClient, operator: Account, space: int,
                                        monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = make_board(client, space)
    monkeypatch.setattr(boards, "MAX_UPDATE", 200)
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one:
        browser = Browser(one)
        browser.sync()
        browser.change("big", {"kind": "text", "x": 0, "y": 0, "w": 1, "h": 1, "text": "x" * 500})
        with pytest.raises(Exception):  # noqa: B017 - the server closes with 4413
            one.receive_bytes()
    assert stored_updates(board_id) == 0


def test_rights_taken_away_end_the_connection(client: TestClient, operator: Account, space: int,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = make_board(client, space)
    anna = make_account("anna")
    join(client, space, "anna", "write")
    monkeypatch.setattr(live, "RECHECK_SECONDS", 0)
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(anna)}) as two:
        browser = Browser(two)
        browser.sync()
        assert client.delete(f"/api/spaces/{space}/members/anna").status_code == 204
        browser.change("after", {"kind": "note", "x": 0, "y": 0, "w": 1, "h": 1, "color": "gray", "text": "late"})
        with pytest.raises(Exception):  # noqa: B017
            two.receive_bytes()
    assert stored_updates(board_id) == 0


def test_bringing_a_version_back_reaches_everyone(client: TestClient, operator: Account, space: int) -> None:
    board_id = make_board(client, space, content={"items": [
        {"id": "first-note", "kind": "note", "x": 0, "y": 0, "w": 100, "h": 100, "color": "blue", "text": "one"},
    ], "lines": []})
    with SessionLocal() as db:
        board = db.get(Board, board_id)
        assert board is not None
        boards.fold(db, board_id, boards.load(db, board), {"tester"})
    version = client.get(f"/api/boards/{board_id}/versions").json()[0]["id"]
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one:
        browser = Browser(one)
        browser.sync()
        browser.change("first-note", {"kind": "note", "x": 0, "y": 0, "w": 100, "h": 100, "color": "blue",
                                      "text": "changed"})
        browser.change("second-note", {"kind": "note", "x": 0, "y": 0, "w": 9, "h": 9, "color": "blue", "text": "2"})
        wait_for(lambda: stored_updates(board_id) == 2)
        with new_client(operator) as other:
            assert other.post(f"/api/boards/{board_id}/versions/{version}/restore").status_code == 200
        browser.receive_update()
        assert browser.items.to_py() == {"first-note": {"kind": "note", "x": 0.0, "y": 0.0, "w": 100.0, "h": 100.0,
                                                        "color": "blue", "z": 0.0}}
        assert browser.texts.to_py() == {"first-note": "one"}


def test_two_people_type_in_the_same_note_and_both_words_stay(client: TestClient, operator: Account,
                                                               space: int) -> None:
    from pycrdt import Text

    board_id = make_board(client, space, content={"items": [
        {"id": "shared-note", "kind": "note", "x": 0, "y": 0, "w": 100, "h": 100, "color": "blue", "text": "Milch"},
    ], "lines": []})
    anna = make_account("anna")
    join(client, space, "anna", "write")
    with client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(operator)}) as one, \
            client.websocket_connect(f"/api/boards/{board_id}/live", headers={"cookie": cookie_of(anna)}) as two:
        first, second = Browser(one), Browser(two)
        first.sync()
        second.sync()
        # Both type at the same moment, before either sees the other: one at the start, one at the end.
        for browser, at, words in ((first, 0, "Hafer"), (second, 5, ", Brot")):
            before = browser.doc.get_state()
            text = browser.texts["shared-note"]
            assert isinstance(text, Text)
            text.insert(at, words)
            browser.socket.send_bytes(create_update_message(browser.doc.get_update(before)))
        first.receive_update()
        second.receive_update()
        assert str(first.texts["shared-note"]) == str(second.texts["shared-note"]) == "HaferMilch, Brot"
    wait_for(lambda: stored_updates(board_id) == 0)
    picture = client.get(f"/api/boards/{board_id}").json()["picture"]
    assert picture["items"][0]["text"] == "HaferMilch, Brot"

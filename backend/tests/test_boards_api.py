"""Spaces, boards, media, public pages and backups over HTTP, with the rights of each."""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import SessionLocal
from app.models import Account, Media
from app.services import backups, media_store, settings_service

from .conftest import join, make_account, new_client


def board(client: TestClient, space: int, title: str = "Plan", content: dict | None = None) -> dict:
    answer = client.post("/api/boards", json={"space_id": space, "title": title, "content": content})
    assert answer.status_code == 201, answer.text
    return answer.json()


def jpeg(width: int = 40, height: int = 30, gps: bool = False) -> bytes:
    image = Image.new("RGB", (width, height), (200, 120, 40))
    out = io.BytesIO()
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {1: "N", 2: (52.0, 31.0, 12.0), 3: "E", 4: (13.0, 24.0, 18.0)}
        exif[0x010F] = "PhoneMaker"
    image.save(out, "JPEG", exif=exif)
    return out.getvalue()


# --- Spaces and boards ------------------------------------------------------------------------------------------------


def test_a_space_belongs_to_its_maker_and_others_see_nothing_of_it(client: TestClient, operator: Account,
                                                                   space: int) -> None:
    anna = make_account("anna")
    with new_client(anna) as browser:
        assert browser.get("/api/spaces").json() == []
        # A space somebody may not read answers like one that does not exist, wherever it is asked about.
        made = board(client, space)
        for path in (f"/api/boards/{made['id']}", f"/api/spaces/{space}/members"):
            assert browser.get(path).status_code == 404
        assert browser.post("/api/boards", json={"space_id": space, "title": "x"}).status_code == 404
        assert browser.get("/api/boards").json() == []
        assert browser.get("/api/search", params={"q": "plan"}).json() == []


def test_readers_read_writers_write_managers_manage(client: TestClient, operator: Account, space: int) -> None:
    rita, will = make_account("rita"), make_account("will")
    join(client, space, "rita", "read")
    join(client, space, "will", "write")
    made = board(client, space)
    with new_client(rita) as reader, new_client(will) as writer:
        assert reader.get(f"/api/boards/{made['id']}").json()["role"] == "read"
        assert reader.patch(f"/api/boards/{made['id']}", json={"title": "Mine"}).status_code == 403
        assert reader.delete(f"/api/boards/{made['id']}").status_code == 403
        assert reader.post("/api/boards", json={"space_id": space, "title": "x"}).status_code == 403
        assert writer.patch(f"/api/boards/{made['id']}", json={"title": "Ours"}).json()["title"] == "Ours"
        assert writer.patch(f"/api/spaces/{space}", json={"name": "Taken"}).status_code == 403
        assert writer.delete(f"/api/boards/{made['id']}").status_code == 204
        # In the bin: gone from the list, back with restore, and the reader cannot see the bin.
        assert writer.get("/api/boards").json() == []
        assert [b["id"] for b in writer.get("/api/boards", params={"deleted": True}).json()] == [made["id"]]
        assert reader.get("/api/boards", params={"deleted": True}).json() == []
        assert writer.post(f"/api/boards/{made['id']}/restore").status_code == 200
    assert client.patch(f"/api/spaces/{space}", json={"name": "Family", "color": "#60a5fa"}).json()["name"] == "Family"


def test_a_space_only_takes_the_colours_offered(client: TestClient, operator: Account, space: int) -> None:
    answer = client.patch(f"/api/spaces/{space}", json={"color": "red;x:url(y)"})
    assert answer.status_code == 422 and answer.json()["detail"]["code"] == "invalid_color"
    # Longer ones do not even reach the check.
    assert client.patch(f"/api/spaces/{space}", json={"color": "red; background:url(x)"}).status_code == 422


def test_moving_a_board_needs_writing_in_both_spaces_and_ends_its_public_page(client: TestClient,
                                                                             operator: Account, space: int) -> None:
    other = client.post("/api/spaces", json={"name": "Other"}).json()["id"]
    made = board(client, space)
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
    assert client.put(f"/api/boards/{made['id']}/share", json={"days": 7}).status_code == 200
    moved = client.patch(f"/api/boards/{made['id']}", json={"space_id": other}).json()
    assert moved["space_id"] == other and moved["public"] is False
    anna = make_account("anna")
    stranger_space = None
    with new_client(anna) as browser:
        stranger_space = browser.post("/api/spaces", json={"name": "Anna's"}).json()["id"]
    assert client.patch(f"/api/boards/{made['id']}", json={"space_id": stranger_space}).status_code == 404


def test_templates_and_copies_bring_their_items(client: TestClient, operator: Account, space: int) -> None:
    made = board(client, space, content={"items": [
        {"id": "note-one", "kind": "note", "x": 0, "y": 0, "w": 10, "h": 10, "color": "pink", "text": "Hi"},
        {"id": "bad", "kind": "script", "x": 0},
        {"id": "<x>", "kind": "note", "x": 0},
    ], "lines": []})
    assert made["items"] == 1
    copy = client.post(f"/api/boards/{made['id']}/copy", json={"title": "Copy"}).json()
    assert copy["picture"]["items"][0]["text"] == "Hi" and copy["id"] != made["id"]


def test_favourites_and_visits_are_per_account(client: TestClient, operator: Account, space: int) -> None:
    made = board(client, space)
    assert client.put(f"/api/boards/{made['id']}/favorite", json={"on": True}).json() == {"favorite": True}
    assert client.post(f"/api/boards/{made['id']}/visit").status_code == 204
    listed = client.get("/api/boards").json()[0]
    assert listed["favorite"] is True and listed["opened_at"]
    anna = make_account("anna")
    join(client, space, "anna", "read")
    with new_client(anna) as browser:
        assert browser.get("/api/boards").json()[0]["favorite"] is False


# --- Media -----------------------------------------------------------------------------------------------------------


def test_a_photo_comes_in_without_place_and_device_and_only_members_see_it(client: TestClient, operator: Account,
                                                                          space: int) -> None:
    answer = client.post("/api/media", params={"space": space, "name": "beach.jpg"}, content=jpeg(gps=True))
    assert answer.status_code == 201, answer.text
    stored = answer.json()
    assert stored["kind"] == "jpeg" and stored["width"] == 40 and "location" in stored["removed"]
    data = media_store.path_of(stored["id"]).read_bytes()
    assert b"PhoneMaker" not in data
    shown = client.get(f"/api/media/{stored['id']}")
    assert shown.status_code == 200 and shown.headers["content-type"] == "image/jpeg"
    assert "sandbox" in shown.headers["content-security-policy"]
    # The same bytes again: kept once.
    again = client.post("/api/media", params={"space": space, "name": "again.jpg"}, content=jpeg(gps=True)).json()
    assert again["id"] == stored["id"] and again["known"] is True
    anna = make_account("anna")
    with new_client(anna) as browser:
        assert browser.get(f"/api/media/{stored['id']}").status_code == 404
        assert browser.post("/api/media", params={"space": space, "name": "x.jpg"}, content=jpeg()).status_code == 404


def test_a_large_photo_gets_a_smaller_copy(client: TestClient, operator: Account, space: int) -> None:
    stored = client.post("/api/media", params={"space": space, "name": "big.jpg"}, content=jpeg(3000, 2000)).json()
    small = client.get(f"/api/media/{stored['id']}", params={"preview": True})
    assert small.status_code == 200 and small.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(small.content)) as image:
        assert max(image.size) == media_store.PREVIEW_SIDE
    original = client.get(f"/api/media/{stored['id']}")
    assert original.headers["content-type"] == "image/jpeg"


def test_files_that_could_run_are_only_ever_downloads(client: TestClient, operator: Account, space: int) -> None:
    page = b"<html><script>alert(1)</script></html>"
    stored = client.post("/api/media", params={"space": space, "name": "page.png"}, content=page).json()
    assert stored["kind"] == "file"
    answer = client.get(f"/api/media/{stored['id']}")
    assert answer.headers["content-type"] == "application/octet-stream"
    assert answer.headers["content-disposition"].startswith("attachment")


def test_an_upload_has_a_limit(client: TestClient, operator: Account, space: int) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"upload_max_mb": 1})
    answer = client.post("/api/media", params={"space": space, "name": "big.bin"}, content=b"x" * (1024 * 1024 + 1))
    assert answer.status_code == 413 and answer.json()["detail"]["code"] == "too_large"
    assert [path for path in media_store.root().iterdir() if not path.name.startswith(".")] == []


# --- Public pages ----------------------------------------------------------------------------------------------------


def _with_photo(client: TestClient, space: int) -> tuple[dict, str, str]:
    on_board = client.post("/api/media", params={"space": space, "name": "a.jpg"}, content=jpeg(20, 20)).json()["id"]
    elsewhere = client.post("/api/media", params={"space": space, "name": "b.jpg"}, content=jpeg(21, 20)).json()["id"]
    made = board(client, space, content={"items": [
        {"id": "photo-one", "kind": "image", "x": 0, "y": 0, "w": 20, "h": 20, "media": on_board},
    ], "lines": []})
    return made, on_board, elsewhere


def test_a_public_page_is_closed_until_the_operator_opens_it(client: TestClient, operator: Account,
                                                             space: int) -> None:
    made, _, _ = _with_photo(client, space)
    answer = client.put(f"/api/boards/{made['id']}/share", json={"days": 7})
    assert answer.status_code == 403 and answer.json()["detail"]["code"] == "shares_off"


def test_a_public_page_shows_its_board_and_its_photos_only(client: TestClient, operator: Account, space: int) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
    made, on_board, elsewhere = _with_photo(client, space)
    link = client.put(f"/api/boards/{made['id']}/share", json={"days": 7}).json()["link"]
    token = link.rsplit("/", 1)[1]
    with new_client() as visitor:
        page = visitor.get(f"/api/public/{token}").json()
        assert page["title"] == "Plan" and page["picture"]["items"][0]["media"] == on_board
        assert visitor.get(f"/api/public/{token}/media/{on_board}").status_code == 200
        # Another photo of the same space, not on this board: as if it did not exist.
        assert visitor.get(f"/api/public/{token}/media/{elsewhere}").status_code == 404
        assert visitor.get(f"/api/media/{on_board}").status_code == 401
    # Closed by the operator: every page answers like none.
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": False})
    with new_client() as visitor:
        assert visitor.get(f"/api/public/{token}").status_code == 404


def test_a_page_with_a_password_opens_with_it_and_a_guesser_is_slowed(client: TestClient, operator: Account,
                                                                     space: int) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
    made, on_board, _ = _with_photo(client, space)
    link = client.put(f"/api/boards/{made['id']}/share", json={"days": 7, "password": "open sesame"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    with new_client() as visitor:
        assert visitor.get(f"/api/public/{token}").json() == {"password": True, "title": ""}
        assert visitor.get(f"/api/public/{token}/media/{on_board}").status_code == 404
        assert visitor.post(f"/api/public/{token}", json={"password": "wrong"}).status_code == 401
        assert visitor.post(f"/api/public/{token}", json={"password": "open sesame"}).status_code == 200
        # The browser that gave it is let in afterwards, photos too.
        assert visitor.get(f"/api/public/{token}").json()["title"] == "Plan"
        assert visitor.get(f"/api/public/{token}/media/{on_board}").status_code == 200
    with new_client() as guesser:
        codes = [guesser.post(f"/api/public/{token}", json={"password": f"guess {n}"}).status_code for n in range(8)]
        assert 429 in codes


def test_only_managers_put_a_board_on_a_public_page(client: TestClient, operator: Account, space: int) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"shares_allowed": True})
    made = board(client, space)
    will = make_account("will")
    join(client, space, "will", "write")
    with new_client(will) as writer:
        assert writer.put(f"/api/boards/{made['id']}/share", json={"days": 7}).status_code == 403


# --- Backups ---------------------------------------------------------------------------------------------------------


def test_a_backup_holds_the_database_and_the_media_and_checks_whole(client: TestClient, operator: Account,
                                                                   space: int) -> None:
    board(client, space)
    stored = client.post("/api/media", params={"space": space, "name": "big.jpg"}, content=jpeg(3000, 2000)).json()
    name = client.post("/api/backups", json={"note": "test"}).json()["name"]
    with zipfile.ZipFile(backups.folder() / name) as archive:
        names = set(archive.namelist())
    assert {backups.DATABASE_ENTRY, backups.MANIFEST, f"media/{stored['id']}", f"media/{stored['id']}.p"} <= names
    check = client.post(f"/api/backups/{name}/check").json()
    assert check["usable"] is True and check["boards"] == 1 and check["files"] == 2


def test_a_damaged_backup_is_refused(client: TestClient, operator: Account, space: int) -> None:
    client.post("/api/media", params={"space": space, "name": "a.jpg"}, content=jpeg())
    name = client.post("/api/backups", json={}).json()["name"]
    path = backups.folder() / name
    with zipfile.ZipFile(path) as archive:
        entries = {info.filename: archive.read(info.filename) for info in archive.infolist()}
    media_entry = next(key for key in entries if key.startswith("media/"))
    entries[media_entry] = entries[media_entry][:-3] + b"xyz"
    with zipfile.ZipFile(path, "w") as archive:
        for key, data in entries.items():
            archive.writestr(key, data)
    assert client.post(f"/api/backups/{name}/check").json()["usable"] is False


@pytest.mark.parametrize("member", [True, False])
def test_a_media_row_without_its_file_answers_not_found(client: TestClient, operator: Account, space: int,
                                                        member: bool) -> None:
    stored = client.post("/api/media", params={"space": space, "name": "a.jpg"}, content=jpeg()).json()
    media_store.path_of(stored["id"]).unlink()
    with SessionLocal() as db:
        assert db.get(Media, stored["id"]) is not None
    assert client.get(f"/api/media/{stored['id']}").status_code == 404

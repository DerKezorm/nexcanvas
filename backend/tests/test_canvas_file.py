"""JSON Canvas out and back in: for nexlore and Obsidian, without losing what only nexcanvas knows."""

from __future__ import annotations

import io
import json
import zipfile

from fastapi.testclient import TestClient
from PIL import Image

from app.db import SessionLocal
from app.models import Account, Media
from app.services import settings_service

from .conftest import join, make_account, new_client


def board(client: TestClient, space: int, title: str = "Plan", content: dict | None = None) -> dict:
    answer = client.post("/api/boards", json={"space_id": space, "title": title, "content": content})
    assert answer.status_code == 201, answer.text
    return answer.json()


def jpeg(width: int = 40, height: int = 30, color: tuple[int, int, int] = (200, 120, 40)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, "JPEG")
    return out.getvalue()


def picture(client: TestClient, board_id: str) -> dict:
    return client.get(f"/api/boards/{board_id}").json()["picture"]


def everything(media_id: str) -> dict:
    """A board with one of every kind, turned, grouped, framed and connected."""
    return {
        "items": [
            {"id": "frame001", "kind": "frame", "x": -40, "y": -60, "w": 900, "h": 600, "title": "Ideen", "color": "#60a5fa"},
            {"id": "note0001", "kind": "note", "x": 0, "y": 0, "w": 180, "h": 180, "color": "pink", "text": "Erste Idee",
             "rot": 12.5, "group": "grp1"},
            {"id": "shape001", "kind": "shape", "x": 300, "y": 0, "w": 160, "h": 120, "shape": "star", "fill": "#fbbf24",
             "stroke": "none", "text": "Stern", "group": "grp1"},
            {"id": "text0001", "kind": "text", "x": 0, "y": 300, "w": 280, "h": 30, "size": "xl", "color": "auto",
             "text": "Überschrift", "hand": True},
            {"id": "ink00001", "kind": "ink", "x": 500, "y": 300, "w": 50, "h": 40, "ow": 50, "oh": 40,
             "points": [[1, 1, 0.5], [40, 30, 0.5]], "color": "#f87171", "size": 3,
             "on": {"item": "shape001", "page": 2}},
            {"id": "image001", "kind": "image", "x": 600, "y": 0, "w": 200, "h": 150, "media": media_id},
            {"id": "link0001", "kind": "link", "x": 300, "y": 300, "w": 230, "h": 190, "url": "https://www.example.com/a",
             "title": "A", "site": "www.example.com", "hue": 120},
        ],
        "lines": [
            {"id": "line0001", "kind": "line", "a": {"item": "note0001", "x": 0, "y": 0},
             "b": {"item": "shape001", "x": 0, "y": 0}, "color": "auto", "width": 4, "arrow": "both", "curve": True,
             "dashed": True},
            {"id": "line0002", "kind": "line", "a": {"x": 10, "y": 500}, "b": {"item": "text0001", "x": 0, "y": 0},
             "color": "#4ade80", "width": 2, "arrow": "end", "curve": False},
        ],
    }


def test_a_board_goes_out_as_json_canvas_in_obsidians_writing(client: TestClient, operator: Account,
                                                              space: int) -> None:
    photo = client.post("/api/media", params={"space": space, "name": "strand.jpg"}, content=jpeg()).json()
    made = board(client, space, "Mein Plan", everything(photo["id"]))
    answer = client.get(f"/api/boards/{made['id']}/export")
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/zip"
    assert "Mein%20Plan.zip" in answer.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(answer.content))
    assert sorted(archive.namelist()) == ["Mein Plan.canvas", "attachments/strand.jpg"]
    assert archive.read("attachments/strand.jpg")[:3] == b"\xff\xd8\xff"
    text = archive.read("Mein Plan.canvas").decode("utf-8")
    # Obsidian's form: one card per line, tabs, raw umlauts, no break at the end.
    assert text.startswith('{\n\t"nodes":[\n\t\t{"id":"frame001","type":"group"')
    assert not text.endswith("\n") and "Überschrift" in text
    canvas = json.loads(text)
    nodes = {node["id"]: node for node in canvas["nodes"]}
    assert nodes["frame001"]["label"] == "Ideen" and nodes["frame001"]["color"] == "#60a5fa"
    assert nodes["note0001"]["type"] == "text" and nodes["note0001"]["color"] == "#fbcfe8"
    assert nodes["image001"] == {**nodes["image001"], "type": "file", "file": "attachments/strand.jpg"}
    assert nodes["link0001"]["url"] == "https://www.example.com/a"
    assert "ink00001" not in nodes and canvas["nexcanvas"]["items"][0]["id"] == "ink00001"
    # An arrow between two cards is an edge; one with a free end rides in the nexcanvas block.
    assert canvas["edges"] == [{"id": "line0001", "fromNode": "note0001", "toNode": "shape001", "fromEnd": "arrow",
                                "nexcanvas": {"kind": "line", "color": "auto", "width": 4, "arrow": "both",
                                              "curve": True, "dashed": True}}]
    assert [line["id"] for line in canvas["nexcanvas"]["lines"]] == ["line0002"]


def test_without_files_it_is_a_plain_canvas_file(client: TestClient, operator: Account, space: int) -> None:
    made = board(client, space, "Leer: oder?", {"items": [{"id": "note0001", "kind": "note", "x": 0, "y": 0, "w": 10,
                                                           "h": 10, "color": "yellow", "text": "x"}]})
    answer = client.get(f"/api/boards/{made['id']}/export")
    assert answer.headers["content-type"] == "application/json"
    assert "Leer%20%20oder.canvas" in answer.headers["content-disposition"]
    assert json.loads(answer.content)["edges"] == []
    assert answer.text.split("\n")[3:5] == ["\t],", '\t"edges":[],']
    # Only nexcanvas reads the block at the end; the board's name travels in it.
    assert json.loads(answer.content)["nexcanvas"]["title"] == "Leer: oder?"


def test_what_went_out_comes_back_whole_into_another_space(client: TestClient, operator: Account, space: int) -> None:
    photo = client.post("/api/media", params={"space": space, "name": "strand.jpg"}, content=jpeg()).json()
    made = board(client, space, "Plan", everything(photo["id"]))
    exported = client.get(f"/api/boards/{made['id']}/export").content
    other = client.post("/api/spaces", json={"name": "Elsewhere"}).json()["id"]
    target = board(client, other, "Kopie")
    answer = client.post(f"/api/boards/{target['id']}/import", params={"x": 1000, "y": 2000}, content=exported)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"items": 7, "lines": 2, "files": 1, "missing": [], "skipped": 0}
    before = {item["id"]: item for item in picture(client, made["id"])["items"]}
    after = picture(client, target["id"])
    kinds = {item["kind"]: item for item in after["items"]}
    assert sorted(kinds) == sorted(item["kind"] for item in before.values())
    # New ids, the same things.
    assert not set(before) & {item["id"] for item in after["items"]}
    assert kinds["note"]["text"] == "Erste Idee" and kinds["note"]["rot"] == 12.5 and kinds["note"]["color"] == "pink"
    assert kinds["shape"]["shape"] == "star" and kinds["shape"]["text"] == "Stern"
    assert kinds["text"]["size"] == "xl" and kinds["text"]["hand"] is True
    assert kinds["ink"]["points"] == [[1, 1, 0.5], [40, 30, 0.5]]
    # A drawing on a page stays with what it was drawn on, under its new id.
    assert kinds["ink"]["on"] == {"item": kinds["shape"]["id"], "page": 2}
    assert kinds["frame"]["title"] == "Ideen"
    # The group came along under a name of its own.
    assert kinds["note"]["group"] == kinds["shape"]["group"] != "grp1"
    # The photo is now a file of the other space.
    with SessionLocal() as db:
        row = db.get(Media, kinds["image"]["media"])
        assert row is not None and row.space_id == other and row.id != photo["id"]
    # Lines join the new items; the free end moved with everything.
    lines = {line["arrow"]: line for line in after["lines"]}
    assert lines["both"]["a"]["item"] == kinds["note"]["id"] and lines["both"]["b"]["item"] == kinds["shape"]["id"]
    assert lines["both"]["width"] == 4 and lines["both"]["dashed"] is True
    assert lines["end"]["b"]["item"] == kinds["text"]["id"] and "item" not in lines["end"]["a"]
    # Around the point asked for: the middle of what came in.
    left = min(i["x"] for i in after["items"])
    right = max(i["x"] + i["w"] for i in after["items"])
    top = min(i["y"] for i in after["items"])
    bottom = max(i["y"] + i["h"] for i in after["items"])
    assert abs((left + right) / 2 - 1000) < 1 and abs((top + bottom) / 2 - 2000) < 1
    shift = kinds["note"]["x"] - before["note0001"]["x"]
    assert abs(lines["end"]["a"]["x"] - (10 + shift)) < 0.2


def test_a_canvas_from_obsidian_becomes_notes_frames_and_links(client: TestClient, operator: Account,
                                                               space: int) -> None:
    canvas = {
        "nodes": [
            {"id": "a", "type": "text", "text": "# Hallo", "x": 0, "y": 0, "width": 250, "height": 60, "color": "1"},
            {"id": "b", "type": "text", "text": "Ohne Farbe", "x": 300, "y": 0, "width": 250, "height": 60},
            {"id": "c", "type": "group", "label": "Gruppe", "x": -20, "y": -20, "width": 600, "height": 200,
             "color": "4"},
            {"id": "d", "type": "link", "url": "https://www.example.org", "x": 0, "y": 300, "width": 400,
             "height": 300},
            {"id": "e", "type": "link", "url": "javascript:alert(1)", "x": 0, "y": 700, "width": 400, "height": 300},
            {"id": "f", "type": "file", "file": "Notizen/Plan.md", "x": 500, "y": 300, "width": 400, "height": 300},
            {"id": "g", "type": "weird", "x": 0, "y": 0, "width": 1, "height": 1},
        ],
        "edges": [
            {"id": "e1", "fromNode": "a", "fromSide": "right", "toNode": "b", "toSide": "left"},
            {"id": "e2", "fromNode": "a", "toNode": "nowhere"},
        ],
    }
    made = board(client, space)
    answer = client.post(f"/api/boards/{made['id']}/import", content=json.dumps(canvas).encode())
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"items": 6, "lines": 1, "files": 0, "missing": ["Notizen/Plan.md"], "skipped": 2}
    items = picture(client, made["id"])["items"]
    notes = {item["text"]: item for item in items if item["kind"] == "note"}
    assert notes["# Hallo"]["color"] == "pink" and notes["Ohne Farbe"]["color"] == "gray"
    # A link that is no web address never becomes a link; the words stay readable as a note.
    assert "javascript:alert(1)" in notes
    assert notes["Plan.md"]["color"] == "gray"
    assert [item["url"] for item in items if item["kind"] == "link"] == ["https://www.example.org"]
    frame = next(item for item in items if item["kind"] == "frame")
    assert frame["title"] == "Gruppe" and frame["color"] == "#4ade80"
    line = picture(client, made["id"])["lines"][0]
    assert line["arrow"] == "end" and line["a"]["item"] == notes["# Hallo"]["id"]


def test_a_file_the_card_names_comes_from_the_archive_and_nowhere_else(client: TestClient, operator: Account,
                                                                       space: int) -> None:
    canvas = {"nodes": [
        {"id": "a", "type": "file", "file": "attachments/foto.jpg", "x": 0, "y": 0, "width": 200, "height": 150},
        {"id": "b", "type": "file", "file": "../../etc/passwd", "x": 300, "y": 0, "width": 200, "height": 150},
        {"id": "c", "type": "file", "file": "attachments/gross.jpg", "x": 600, "y": 0, "width": 200, "height": 150},
    ], "edges": []}
    with SessionLocal() as db:
        settings_service.save(db, {"upload_max_mb": 1})
        db.commit()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Board.canvas", json.dumps(canvas))
        archive.writestr("attachments/foto.jpg", jpeg())
        archive.writestr("attachments/gross.jpg", jpeg() + b"\0" * (2 * 1024 * 1024))
    made = board(client, space)
    answer = client.post(f"/api/boards/{made['id']}/import", content=buffer.getvalue())
    assert answer.status_code == 200, answer.text
    assert answer.json()["files"] == 1
    assert answer.json()["missing"] == ["../../etc/passwd", "attachments/gross.jpg"]
    kinds = sorted(item["kind"] for item in picture(client, made["id"])["items"])
    assert kinds == ["image", "note", "note"]


def test_readers_may_take_a_canvas_out_but_not_bring_one_in(client: TestClient, operator: Account, space: int) -> None:
    made = board(client, space, content={"items": [{"id": "note0001", "kind": "note", "x": 0, "y": 0, "w": 10, "h": 10,
                                                    "color": "yellow", "text": "x"}]})
    canvas = client.get(f"/api/boards/{made['id']}/export").content
    rita, anna = make_account("rita"), make_account("anna")
    join(client, space, "rita", "read")
    with new_client(rita) as reader, new_client(anna) as stranger:
        assert reader.get(f"/api/boards/{made['id']}/export").status_code == 200
        assert reader.post(f"/api/boards/{made['id']}/import", content=canvas).status_code == 403
        assert stranger.get(f"/api/boards/{made['id']}/export").status_code == 404
        assert stranger.post(f"/api/boards/{made['id']}/import", content=canvas).status_code == 404
    assert len(picture(client, made["id"])["items"]) == 1


def test_what_is_no_canvas_is_refused_by_name(client: TestClient, operator: Account, space: int) -> None:
    made = board(client, space)
    url = f"/api/boards/{made['id']}/import"
    assert client.post(url, content=b"\x89PNG not a canvas").json()["detail"]["code"] == "invalid_canvas"
    assert client.post(url, content=b'{"nodes": "many"}').json()["detail"]["code"] == "invalid_canvas"
    assert client.post(url, content=b'{"nodes": [], "edges": []}').json()["detail"]["code"] == "empty_canvas"
    assert client.post(url, content=b"").json()["detail"]["code"] == "empty"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "no canvas here")
    assert client.post(url, content=buffer.getvalue()).json()["detail"]["code"] == "invalid_canvas"
    assert picture(client, made["id"])["items"] == []


ROUTER = {
    "id": "router", "name": {"en": "Router"}, "vw": 24, "vh": 24, "keep": True,
    "elements": [{"t": "rect", "x": 2, "y": 14, "width": 20, "height": 8, "rx": 2, "f": "fill", "s": "line"},
                 {"t": "path", "d": "M6 18h.01", "f": "none", "s": "ink"}],
    "fill": "#3b82f6",
}


def carried() -> dict:
    """A board with a background of its own and a shape it carries (an icon), as another nexcanvas would export it."""
    return {
        "items": [
            {"id": "note0001", "kind": "note", "x": 0, "y": 0, "w": 180, "h": 180, "color": "yellow", "text": "Hallo"},
            {"id": "shape001", "kind": "shape", "x": 300, "y": 0, "w": 64, "h": 64, "shape": "rect",
             "lib": "icons-devices/router", "fill": "#3b82f6", "stroke": "none", "text": ""},
        ],
        "lines": [],
        "background": {"pattern": "grid", "color": "paper"},
        "defs": {"icons-devices/router": ROUTER},
    }


def test_a_board_goes_to_another_nexcanvas_as_a_file_and_comes_back_whole(client: TestClient, operator: Account,
                                                                         space: int) -> None:
    made = board(client, space, "Heimnetz: Plan", carried())
    exported = client.get(f"/api/boards/{made['id']}/export").content
    other = client.post("/api/spaces", json={"name": "Elsewhere"}).json()["id"]
    answer = client.post("/api/boards/from-file", params={"space_id": other, "name": "anything.canvas"},
                         content=exported)
    assert answer.status_code == 201, answer.text
    body = answer.json()
    assert body["items"] == 2 and body["missing"] == []
    # The name it had, not the name of the file; in the space asked for.
    assert body["board"]["title"] == "Heimnetz: Plan" and body["board"]["space_id"] == other
    renamed = client.post("/api/boards/from-file", params={"space_id": other, "title": "Mein Netz"}, content=exported)
    assert renamed.json()["board"]["title"] == "Mein Netz"
    after = picture(client, body["board"]["id"])
    assert after["background"] == {"pattern": "grid", "color": "paper"}
    # The icon comes with its drawing, so it draws there even without the icon packages.
    assert after["defs"]["icons-devices/router"]["elements"][1]["s"] == "ink"
    shape = next(item for item in after["items"] if item["kind"] == "shape")
    assert shape["lib"] == "icons-devices/router"


def test_a_board_from_a_file_is_named_after_the_file_when_it_carries_no_name(client: TestClient, operator: Account,
                                                                              space: int) -> None:
    canvas = {"nodes": [{"id": "a", "type": "text", "text": "Hallo", "x": 0, "y": 0, "width": 250, "height": 60}],
              "edges": []}
    named = client.post("/api/boards/from-file", params={"space_id": space, "name": "Projekt.canvas"},
                        content=json.dumps(canvas).encode())
    assert named.status_code == 201 and named.json()["board"]["title"] == "Projekt"
    unnamed = client.post("/api/boards/from-file", params={"space_id": space}, content=json.dumps(canvas).encode())
    assert unnamed.json()["board"]["title"] == "Imported board"
    # A path the browser sent along stays out of the name.
    pathed = client.post("/api/boards/from-file", params={"space_id": space, "name": "C:\\Users\\x\\Reise.canvas"},
                         content=json.dumps(canvas).encode())
    assert pathed.json()["board"]["title"] == "Reise"


def test_what_is_no_canvas_leaves_no_empty_board_behind(client: TestClient, operator: Account, space: int) -> None:
    before = len(client.get("/api/boards", params={"space": space}).json())
    for content in (b"\x89PNG not a canvas", b'{"nodes": [], "edges": []}'):
        answer = client.post("/api/boards/from-file", params={"space_id": space, "name": "x.canvas"}, content=content)
        assert answer.status_code == 422
    assert client.post("/api/boards/from-file", params={"space_id": space}, content=b"").json()["detail"]["code"] == "empty"
    assert len(client.get("/api/boards", params={"space": space}).json()) == before


def test_only_who_may_write_in_the_space_makes_a_board_from_a_file(client: TestClient, operator: Account,
                                                                  space: int) -> None:
    canvas = json.dumps({"nodes": [{"id": "a", "type": "text", "text": "x", "x": 0, "y": 0, "width": 9, "height": 9}],
                         "edges": []}).encode()
    rita, anna = make_account("rita"), make_account("anna")
    join(client, space, "rita", "read")
    with new_client(rita) as reader, new_client(anna) as stranger:
        assert reader.post("/api/boards/from-file", params={"space_id": space}, content=canvas).status_code == 403
        assert stranger.post("/api/boards/from-file", params={"space_id": space}, content=canvas).status_code == 404
    assert client.get("/api/boards", params={"space": space}).json() == []


def test_brought_onto_a_board_with_a_background_of_its_own_it_keeps_its_own(client: TestClient, operator: Account,
                                                                            space: int) -> None:
    exported = client.get(f"/api/boards/{board(client, space, 'Out', carried())['id']}/export").content
    target = board(client, space, "In", {"items": [], "lines": [], "background": {"pattern": "dots", "color": "cream"}})
    assert client.post(f"/api/boards/{target['id']}/import", content=exported).status_code == 200
    after = picture(client, target["id"])
    assert after["background"] == {"pattern": "dots", "color": "cream"}
    assert "icons-devices/router" in after["defs"]
    plain = board(client, space, "Plain")
    client.post(f"/api/boards/{plain['id']}/import", content=exported)
    assert picture(client, plain["id"])["background"] == {"pattern": "grid", "color": "paper"}

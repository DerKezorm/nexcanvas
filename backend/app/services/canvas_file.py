"""Boards as JSON Canvas (jsoncanvas.org, ``.canvas``): out for nexlore and Obsidian, and back in.

JSON Canvas knows cards of text, files, links and groups, and arrows between cards. What nexcanvas has beyond that
(shapes, drawings, turned items, text sizes, lines with a free end) rides along unseen: every card carries the item it
came from under ``nexcanvas``, and drawings and free lines sit in a ``nexcanvas`` block at the top. Other programs
keep fields they do not know (nexlore does, Obsidian does), so a board that goes there and comes back loses nothing;
a card made or moved there comes back as a note or moved.

The file is written the way Obsidian writes it (one card per line, tabs, no line break at the end), so a later change
in Obsidian or nexlore changes exactly the lines it touches.

Photos and files go along in a ZIP archive with the ``.canvas`` file, under ``attachments/``. Coming in, an archive is
read without ever writing its names to disk: each file is taken by the name the card gives, checked like an upload, and
stored as media of the board's space.
"""

from __future__ import annotations

import io
import json
import logging
import math
import re
import secrets
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from pycrdt import Map, Text
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, Board, Media
from . import boards, media_store

logger = logging.getLogger("nexcanvas.canvas")

#: Cards and arrows taken from one file at most.
MAX_CARDS = 5000
#: Files in an archive looked at, at most.
MAX_ENTRIES = 2000
#: A canvas file itself (the JSON), unpacked.
MAX_CANVAS = 16 * 1024 * 1024
MAX_TEXT = 100_000
ATTACHMENTS = "attachments"

#: Paper colours of notes, the same as in the browser.
NOTE_COLORS = {
    "yellow": "#fde68a", "orange": "#fed7aa", "pink": "#fbcfe8", "violet": "#ddd6fe",
    "blue": "#bfdbfe", "green": "#bbf7d0", "gray": "#e4e4e7",
}
#: The six colours JSON Canvas names by number, and the note each turns into.
PRESETS = {"1": "pink", "2": "orange", "3": "yellow", "4": "green", "5": "blue", "6": "violet"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
IMAGES = media_store.IMAGES


class CanvasError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


# --- Out -------------------------------------------------------------------------------------------------------------


def file_stem(title: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", title).strip(" .")
    return stem[:120] or "nexcanvas"


def _int(value: Any) -> int:
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return 0


def _extra(item: dict[str, Any]) -> dict[str, Any]:
    """What nexcanvas knows of an item beyond the card: everything but the id, place, size and words."""
    return {key: value for key, value in item.items() if key not in ("id", "x", "y", "w", "h", "text", "z")}


def write(canvas: dict[str, Any]) -> str:
    """In Obsidian's own writing: each top key on a line, each card of a list on its own line, no break at the end."""
    out = ["{"]
    keys = list(canvas)
    for number, key in enumerate(keys):
        value = canvas[key]
        comma = "," if number < len(keys) - 1 else ""
        if isinstance(value, list) and value:
            out.append(f"\t{json.dumps(key)}:[")
            for index, element in enumerate(value):
                tail = "," if index < len(value) - 1 else ""
                out.append("\t\t" + json.dumps(element, ensure_ascii=False, separators=(",", ":")) + tail)
            out.append("\t]" + comma)
        else:
            out.append(f"\t{json.dumps(key)}:" + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + comma)
    out.append("}")
    return "\n".join(out)


def to_canvas(picture: dict[str, Any], media: dict[str, Media]) -> tuple[dict[str, Any], dict[str, str]]:
    """The board as JSON Canvas, and which media file goes where in the archive (media id to path)."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    hidden_items: list[dict[str, Any]] = []
    hidden_lines: list[dict[str, Any]] = []
    paths: dict[str, str] = {}
    taken: set[str] = set()

    def path_for(media_id: str) -> str | None:
        row = media.get(media_id)
        if row is None:
            return None
        if media_id not in paths:
            name = media_store.clean_name(row.name) or media_id
            stem, dot, ext = name.rpartition(".")
            if not dot:
                stem, ext = name, ""
            candidate, number = name, 2
            while candidate.casefold() in taken:
                candidate = f"{stem} ({number}).{ext}" if ext else f"{stem} ({number})"
                number += 1
            taken.add(candidate.casefold())
            paths[media_id] = f"{ATTACHMENTS}/{candidate}"
        return paths[media_id]

    for item in picture.get("items", []):
        kind = item.get("kind")
        if kind == "ink":
            hidden_items.append({key: value for key, value in item.items() if key != "z"})
            continue
        node: dict[str, Any] = {"id": item["id"]}
        text = item.get("text") if isinstance(item.get("text"), str) else ""
        if kind in ("note", "text", "shape"):
            node["type"] = "text"
            node["text"] = text
        elif kind in ("image", "file"):
            where = path_for(str(item.get("media", "")))
            if where is None:
                node["type"] = "text"
                node["text"] = str(item.get("name") or item.get("caption") or "")
            else:
                node["type"] = "file"
                node["file"] = where
        elif kind == "link":
            node["type"] = "link"
            node["url"] = str(item.get("url", ""))
        elif kind == "frame":
            node["type"] = "group"
        else:
            continue
        node.update(x=_int(item.get("x")), y=_int(item.get("y")), width=max(1, _int(item.get("w"))),
                    height=max(1, _int(item.get("h"))))
        color = None
        if kind == "note":
            color = NOTE_COLORS.get(str(item.get("color")))
        elif kind == "shape" and HEX.match(str(item.get("fill", ""))):
            color = item["fill"]
        elif kind in ("text", "frame") and HEX.match(str(item.get("color", ""))):
            color = item["color"]
        if color:
            node["color"] = color
        if kind == "frame" and item.get("title"):
            node["label"] = str(item["title"])
        node["nexcanvas"] = _extra(item)
        nodes.append(node)

    for line in picture.get("lines", []):
        a, b = line.get("a") or {}, line.get("b") or {}
        if not (isinstance(a, dict) and isinstance(b, dict) and a.get("item") and b.get("item")):
            hidden_lines.append(line)
            continue
        edge: dict[str, Any] = {"id": line["id"], "fromNode": a["item"], "toNode": b["item"]}
        arrow = line.get("arrow", "end")
        if arrow == "none":
            edge["toEnd"] = "none"
        elif arrow == "both":
            edge["fromEnd"] = "arrow"
        if HEX.match(str(line.get("color", ""))):
            edge["color"] = line["color"]
        edge["nexcanvas"] = {key: value for key, value in line.items() if key not in ("id", "a", "b")}
        edges.append(edge)

    canvas: dict[str, Any] = {"nodes": nodes, "edges": edges}
    if hidden_items or hidden_lines:
        canvas["nexcanvas"] = {"version": 1, "items": hidden_items, "lines": hidden_lines}
    return canvas, paths


def export(db: Session, board: Board, picture: dict[str, Any]) -> tuple[bytes, str, str]:
    """The file to download: the bytes, its name and its type. A ``.canvas`` alone, or a ZIP when files go along."""
    wanted = {str(item.get("media")) for item in picture.get("items", []) if item.get("kind") in ("image", "file")}
    rows = db.scalars(select(Media).where(Media.space_id == board.space_id, Media.id.in_(wanted))) if wanted else []
    media = {row.id: row for row in rows if media_store.path_of(row.id).is_file()}
    canvas, paths = to_canvas(picture, media)
    text = write(canvas)
    stem = file_stem(board.title)
    if not paths:
        return text.encode("utf-8"), f"{stem}.canvas", "application/json"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{stem}.canvas", text)
        for media_id, path in paths.items():
            # Photos are compressed already; stored as they are.
            archive.write(media_store.path_of(media_id), path, compress_type=zipfile.ZIP_STORED)
    return buffer.getvalue(), f"{stem}.zip", "application/zip"


# --- In --------------------------------------------------------------------------------------------------------------


@dataclass
class Imported:
    items: int = 0
    lines: int = 0
    files: int = 0
    #: Files a card names that were not in the archive (or not allowed in); they became notes with their name.
    missing: list[str] = field(default_factory=list)
    #: Cards and arrows that made no sense (unknown kind, broken values) and were left out.
    skipped: int = 0


def _read_canvas(data: bytes) -> tuple[dict[str, Any], zipfile.ZipFile | None]:
    archive: zipfile.ZipFile | None = None
    if data[:4] == b"PK\x03\x04":
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            raise CanvasError("invalid_canvas", "This is not a JSON Canvas file or archive.") from exc
        entries = archive.infolist()[:MAX_ENTRIES]
        canvases = [entry for entry in entries if entry.filename.lower().endswith(".canvas") and not entry.is_dir()]
        if not canvases:
            raise CanvasError("invalid_canvas", "The archive holds no .canvas file.")
        canvases.sort(key=lambda entry: (entry.filename.count("/"), entry.filename))
        text = _read_entry(archive, canvases[0], MAX_CANVAS)
        if text is None:
            raise CanvasError("too_large", "The canvas file is too large.", 413)
        data = text
    if len(data) > MAX_CANVAS:
        raise CanvasError("too_large", "The canvas file is too large.", 413)
    try:
        canvas = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanvasError("invalid_canvas", "This is not a JSON Canvas file or archive.") from exc
    shaped = isinstance(canvas, dict) and isinstance(canvas.get("nodes", []), list)
    if not shaped or not isinstance(canvas.get("edges", []), list):
        raise CanvasError("invalid_canvas", "This is not a JSON Canvas file or archive.")
    return canvas, archive


def _read_entry(archive: zipfile.ZipFile, entry: zipfile.ZipInfo, limit: int) -> bytes | None:
    """An entry's bytes, or None when it is larger than ``limit`` (counted while reading: the header may lie)."""
    if entry.file_size > limit:
        return None
    out = bytearray()
    with archive.open(entry) as handle:
        while chunk := handle.read(1024 * 1024):
            out += chunk
            if len(out) > limit:
                return None
    return bytes(out)


def _note_color(value: Any) -> str:
    text = str(value or "")
    if text in PRESETS:
        return PRESETS[text]
    if HEX.match(text):
        wanted = int(text[1:], 16)
        rgb = ((wanted >> 16) & 255, (wanted >> 8) & 255, wanted & 255)

        def distance(name: str) -> int:
            other = int(NOTE_COLORS[name][1:], 16)
            parts = ((other >> 16) & 255, (other >> 8) & 255, other & 255)
            return sum((x - y) ** 2 for x, y in zip(rgb, parts, strict=True))

        return min(NOTE_COLORS, key=distance)
    return "gray"


def _hex(value: Any) -> str | None:
    text = str(value or "")
    if HEX.match(text):
        return text.lower()
    return {"1": "#f87171", "2": "#fb923c", "3": "#fbbf24", "4": "#4ade80", "5": "#2dd4bf", "6": "#a78bfa"}.get(text)


def _number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number) or abs(number) > 1e7:  # far off any board
        return default
    return number


def _safe_url(value: Any) -> str | None:
    text = str(value or "").strip()
    return text[:2000] if re.match(r"^https?://", text, re.IGNORECASE) else None


def _clean_extra(raw: Any, allowed_kind: str | None = None) -> dict[str, Any] | None:
    """An item nexcanvas wrote earlier, taken back only when its kind is known (and fits the card)."""
    if not isinstance(raw, dict) or raw.get("kind") not in boards.KINDS:
        return None
    if allowed_kind is not None and raw["kind"] not in allowed_kind.split("|"):
        return None
    try:
        json.dumps(raw)
    except (TypeError, ValueError):
        return None
    return {key: value for key, value in raw.items() if key not in ("id", "text", "media", "z")}


def import_into(
    db: Session, account: Account, board: Board, data: bytes, at: tuple[float, float]
) -> tuple[bytes, Imported]:
    """Cards and arrows of a JSON Canvas onto the board, around ``at``. Returns the update for the live document."""
    canvas, archive = _read_canvas(data)
    result = Imported()
    limit = media_store.max_bytes(db)
    nodes = [node for node in canvas.get("nodes", [])[:MAX_CARDS] if isinstance(node, dict)]
    result.skipped += max(0, len(canvas.get("nodes", [])) - len(nodes))
    ids: dict[str, str] = {}
    groups: dict[str, str] = {}
    items: list[dict[str, Any]] = []
    stored: dict[str, media_store.Stored | None] = {}
    files = {entry.filename: entry for entry in archive.infolist()[:MAX_ENTRIES]} if archive else {}

    def media_for(path: str) -> media_store.Stored | None:
        if path in stored:
            return stored[path]
        found: media_store.Stored | None = None
        clean = str(PurePosixPath(path))
        entry = files.get(clean) or next((e for name, e in files.items() if name.endswith("/" + clean)), None)
        if entry is not None and not entry.is_dir():
            content = _read_entry(archive, entry, limit) if archive else None
            if content:
                received = media_store.temporary()
                try:
                    received.write_bytes(content)
                    found = media_store.finish(db, account, board.space_id, received, PurePosixPath(clean).name)
                except (OSError, media_store.MediaError):
                    logger.warning("A file of an imported canvas could not be stored board=%s", board.id)
                finally:
                    received.unlink(missing_ok=True)
        stored[path] = found
        if found is not None:
            result.files += 1
        return found

    for node in nodes:
        kind = node.get("type")
        old_id = str(node.get("id", ""))
        new = boards.new_id()
        place = {"x": _number(node.get("x")), "y": _number(node.get("y")),
                 "w": max(8.0, _number(node.get("width"), 250)), "h": max(8.0, _number(node.get("height"), 60))}
        text = node.get("text") if isinstance(node.get("text"), str) else ""
        text = text[:MAX_TEXT]
        item: dict[str, Any] | None = None
        if kind == "text":
            extra = _clean_extra(node.get("nexcanvas"), "note|text|shape")
            if extra:
                item = {**extra, **place, "text": text}
            else:
                item = {"kind": "note", **place, "color": _note_color(node.get("color")), "text": text}
        elif kind == "file":
            path = str(node.get("file", ""))[:500]
            got = media_for(path) if path and archive else None
            if got is None:
                result.missing.append(path)
                item = {"kind": "note", **place, "color": "gray", "text": PurePosixPath(path).name or path}
            elif got.kind in IMAGES and got.width > 0:
                extra = _clean_extra(node.get("nexcanvas"), "image") or {"kind": "image"}
                large = max(got.width, got.height) > media_store.PREVIEW_SIDE
                item = {**extra, **place, "media": got.id, "preview": large}
            else:
                extra = _clean_extra(node.get("nexcanvas"), "file") or {}
                kb = got.size / 1024
                label = f"{kb / 1024:.1f} MB" if kb > 1024 else f"{max(1, round(kb))} KB"
                ext = got.kind if got.kind != "file" else (PurePosixPath(got.name).suffix[1:6].lower() or "file")
                item = {**extra, "kind": "file", **place, "media": got.id, "name": got.name, "ext": ext,
                        "sizeLabel": label}
                if got.kind == "pdf":
                    item["pages"] = got.pages or None
                    item["page"] = int(item.get("page") or 1)
        elif kind == "link":
            url = _safe_url(node.get("url"))
            if url is None:
                item = {"kind": "note", **place, "color": "gray", "text": str(node.get("url", ""))[:2000]}
            else:
                extra = _clean_extra(node.get("nexcanvas"), "link") or {}
                site = re.sub(r"^https?://", "", url, flags=re.IGNORECASE).split("/")[0][:200]
                hue = 0
                for char in site:
                    hue = (hue * 31 + ord(char)) % 360
                item = {"title": site, "site": site, "hue": hue, **extra, "kind": "link", **place, "url": url}
        elif kind == "group":
            extra = _clean_extra(node.get("nexcanvas"), "frame") or {}
            item = {**extra, "kind": "frame", **place, "title": str(node.get("label", ""))[:120],
                    "color": _hex(node.get("color")) or extra.get("color") or "#ff8a70"}
        if item is None:
            result.skipped += 1
            continue
        ids[old_id] = new
        item["id"] = new
        items.append(item)

    hidden = canvas.get("nexcanvas") if isinstance(canvas.get("nexcanvas"), dict) else {}
    for raw in (hidden.get("items") or [])[:MAX_CARDS] if isinstance(hidden.get("items"), list) else []:
        extra = _clean_extra(raw, "ink")
        if extra is None or not isinstance(raw.get("points"), list):
            result.skipped += 1
            continue
        items.append({**extra, "x": _number(raw.get("x")), "y": _number(raw.get("y")),
                      "w": max(1.0, _number(raw.get("w"), 1)), "h": max(1.0, _number(raw.get("h"), 1)),
                      "id": boards.new_id()})

    # Groups of the board that was exported get new names, so they never join a group already on this board.
    for item in items:
        if isinstance(item.get("group"), str):
            item["group"] = groups.setdefault(item["group"], secrets.token_urlsafe(6))

    lines: list[dict[str, Any]] = []
    for edge in [edge for edge in canvas.get("edges", [])[:MAX_CARDS] if isinstance(edge, dict)]:
        start, end = ids.get(str(edge.get("fromNode", ""))), ids.get(str(edge.get("toNode", "")))
        if not start or not end:
            result.skipped += 1
            continue
        extra = edge.get("nexcanvas") if isinstance(edge.get("nexcanvas"), dict) else {}
        arrow = "both" if edge.get("fromEnd") == "arrow" else "none" if edge.get("toEnd") == "none" else "end"
        line = {"kind": "line", "color": _hex(edge.get("color")) or "auto", "width": 2, "curve": True,
                **{k: v for k, v in extra.items() if k in ("color", "width", "curve", "dashed")},
                "arrow": arrow, "a": {"item": start, "x": 0, "y": 0}, "b": {"item": end, "x": 0, "y": 0},
                "id": boards.new_id()}
        lines.append(line)
    for raw in (hidden.get("lines") or [])[:MAX_CARDS] if isinstance(hidden.get("lines"), list) else []:
        if not isinstance(raw, dict) or not isinstance(raw.get("a"), dict) or not isinstance(raw.get("b"), dict):
            result.skipped += 1
            continue
        ends = []
        for end in (raw["a"], raw["b"]):
            target = ids.get(str(end.get("item", ""))) if end.get("item") else None
            ends.append({"item": target, "x": _number(end.get("x")), "y": _number(end.get("y"))} if target
                        else {"x": _number(end.get("x")), "y": _number(end.get("y"))})
        lines.append({**{k: v for k, v in raw.items() if k in ("color", "width", "curve", "dashed", "arrow")},
                      "kind": "line", "a": ends[0], "b": ends[1], "id": boards.new_id()})

    if not items and not lines:
        raise CanvasError("empty_canvas", "There is nothing on this canvas to bring in.")

    # Around the point asked for, on top of everything there is.
    left = min(item["x"] for item in items) if items else 0
    top = min(item["y"] for item in items) if items else 0
    right = max(item["x"] + item["w"] for item in items) if items else 0
    bottom = max(item["y"] + item["h"] for item in items) if items else 0
    dx, dy = at[0] - (left + right) / 2, at[1] - (top + bottom) / 2
    doc = boards.load(db, board)
    present = doc.get("items", type=Map)
    values = (present.to_py() or {}).values()
    z = max((_number(value.get("z")) for value in values if isinstance(value, dict)), default=0.0)
    before = doc.get_state()
    texts = doc.get("texts", type=Map)
    line_map = doc.get("lines", type=Map)
    with doc.transaction():
        for item in items:
            item["x"] = round(item["x"] + dx, 1)
            item["y"] = round(item["y"] + dy, 1)
            z += 1
            value = {key: val for key, val in item.items() if key not in ("id", "text")}
            value["z"] = z
            present[item["id"]] = value
            if item["kind"] in ("note", "text", "shape"):
                texts[item["id"]] = Text(str(item.get("text", "")))
        for line in lines:
            for end in (line["a"], line["b"]):
                if not end.get("item"):
                    end["x"] = round(end["x"] + dx, 1)
                    end["y"] = round(end["y"] + dy, 1)
            line_map[line["id"]] = {key: val for key, val in line.items() if key != "id"}
    update = doc.get_update(before)
    if len(doc.get_update()) > boards.MAX_STATE:
        raise CanvasError("too_large", "With this the board would be too large.", 413)
    result.items = len(items)
    result.lines = len(lines)
    return update, result

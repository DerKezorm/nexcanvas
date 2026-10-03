"""Boards and their content.

A board's content is a Yjs document with three maps: ``items`` (notes, shapes, texts, drawings, photos, files,
links, frames; each a plain JSON object under its id, stacked by its number ``z``), ``lines`` (connections between
items or free points) and ``texts`` (the words of an item as a shared Yjs text under the item's id, so two people
can type in the same note at once). The browser edits the document, the server keeps it (``models.Board``) and
passes changes on (``services/live.py``).

Every change arrives as a Yjs update and is stored at once (``board_updates``); now and then the updates are folded
into the board's state, and the plain JSON picture (``snapshot``) is written from the state. The server never takes
the browser's word for the picture.

What the document holds is people's own data, so it is shown carefully (the interface builds addresses only from
media ids and opens only http and https links), and it has limits: an update of more than ``MAX_UPDATE`` bytes is
refused, and so is any update once the state has grown past ``MAX_STATE``.
"""

from __future__ import annotations

import logging
import re
import secrets
import threading
import unicodedata
from datetime import timedelta
from typing import Any

from pycrdt import Doc, Map, Text
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import Account, Board, BoardUpdate, BoardVersion, utcnow
from . import shapepacks

logger = logging.getLogger("nexcanvas.boards")

#: A single change from a browser; a pasted board of hundreds of items stays far below.
MAX_UPDATE = 4 * 1024 * 1024
#: A whole board. Photos are not inside (they are media files), so this is a lot of notes and drawings.
MAX_STATE = 32 * 1024 * 1024
#: Updates waiting before they are folded into the state.
FOLD_AFTER = 200
#: A version is kept when the last one is older than this and the board changed since.
VERSION_EVERY = timedelta(minutes=30)
#: Versions kept per board; older ones thin out to one a day.
VERSIONS_KEPT = 60
MAX_TITLE = 200

KINDS = frozenset({"note", "shape", "text", "ink", "image", "file", "link", "frame"})
ID = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
#: The look of a board behind its items (block 3): a pattern and a colour, for everybody who has it open.
PATTERNS = frozenset({"none", "dots", "grid", "lines", "mm", "iso"})
NAMED_COLORS = frozenset({"auto", "paper", "cream", "chalk", "blueprint"})
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

#: One lock per board around folding, so two folds never write over each other.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def lock_for(board_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(board_id, threading.Lock())


class BoardError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


def new_id() -> str:
    return secrets.token_urlsafe(9)


def clean_title(title: str) -> str:
    text = " ".join(title.split())
    if not text or len(text) > MAX_TITLE or any(ord(char) < 32 for char in text):
        raise BoardError("invalid_title", "A board needs a name of 1 to 200 characters.")
    return text


# --- The document ----------------------------------------------------------------------------------------------------


def empty_doc() -> Doc:
    doc = Doc()
    doc.get("items", type=Map)
    doc.get("lines", type=Map)
    doc.get("texts", type=Map)
    doc.get("meta", type=Map)
    doc.get("defs", type=Map)
    return doc


#: A shape of a package as a board knows it (block 4): ``package/shape``.
DEF_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}/[a-z0-9][a-z0-9-]{0,39}$")
MAX_DEFS = 300


def clean_defs(value: Any) -> dict[str, dict[str, Any]]:
    """The shapes of packages a board carries, each checked as a package's shape is; the rest left out."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(value, dict):
        return out
    for key, raw in list(value.items())[:MAX_DEFS]:
        if not isinstance(key, str) or not DEF_KEY.match(key):
            continue
        try:
            out[key] = shapepacks.check_shape(raw)
        except shapepacks.PackError:
            continue
    return out


def clean_background(value: Any) -> dict[str, str] | None:
    """A board's background as the page may set it: a known pattern and a named or written colour; else None."""
    if not isinstance(value, dict):
        return None
    pattern = value.get("pattern")
    color = value.get("color")
    if pattern not in PATTERNS or not isinstance(color, str):
        return None
    if color not in NAMED_COLORS and not HEX_COLOR.match(color):
        return None
    return {"pattern": pattern, "color": color.lower() if color.startswith("#") else color}


def doc_from_json(content: dict[str, Any] | None) -> Doc:
    """A document from plain JSON (a template, an import, a copy): only items and lines of a known shape."""
    doc = empty_doc()
    if not content:
        return doc
    items = doc.get("items", type=Map)
    lines = doc.get("lines", type=Map)
    texts = doc.get("texts", type=Map)
    raw_items = content.get("items") if isinstance(content.get("items"), list) else []
    raw_lines = content.get("lines") if isinstance(content.get("lines"), list) else []
    with doc.transaction():
        for number, item in enumerate(raw_items[:5000]):
            if isinstance(item, dict) and item.get("kind") in KINDS and ID.match(str(item.get("id", ""))):
                value = {key: val for key, val in item.items() if key not in ("id", "text")}
                value.setdefault("z", float(number))
                items[str(item["id"])] = value
                if isinstance(item.get("text"), str):
                    texts[str(item["id"])] = Text(item["text"][:100_000])
        for line in raw_lines[:5000]:
            if isinstance(line, dict) and ID.match(str(line.get("id", ""))):
                lines[str(line["id"])] = {key: val for key, val in line.items() if key != "id"}
        background = clean_background(content.get("background"))
        if background:
            doc.get("meta", type=Map)["background"] = background
        defs = doc.get("defs", type=Map)
        for key, shape in clean_defs(content.get("defs")).items():
            defs[key] = shape
    return doc


def snapshot_of(doc: Doc) -> dict[str, Any]:
    """The plain picture: items in stacking order, lines, each with its id."""
    items = doc.get("items", type=Map).to_py() or {}
    lines = doc.get("lines", type=Map).to_py() or {}
    texts = doc.get("texts", type=Map).to_py() or {}
    ordered = sorted(
        (
            {"id": key, **value, **({"text": texts[key]} if isinstance(texts.get(key), str) else {})}
            for key, value in items.items() if isinstance(value, dict)
        ),
        key=lambda item: (_number(item.get("z")), item["id"]),
    )
    connections = [{"id": key, **value} for key, value in lines.items() if isinstance(value, dict)]
    picture: dict[str, Any] = {"items": ordered, "lines": connections}
    background = clean_background((doc.get("meta", type=Map).to_py() or {}).get("background"))
    if background:
        picture["background"] = background
    defs = clean_defs(doc.get("defs", type=Map).to_py() or {})
    if defs:
        picture["defs"] = defs
    return picture


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def words_of(title: str, snapshot: dict[str, Any]) -> str:
    """Everything one could search a board by, folded: its name and the words on it."""
    parts = [title]
    for item in snapshot.get("items", []):
        for key in ("text", "title", "name", "caption", "site", "label"):
            value = item.get(key)
            if isinstance(value, str):
                parts.append(value)
    text = " ".join(parts)
    return unicodedata.normalize("NFC", text).casefold()[:200_000]


def load(db: Session, board: Board) -> Doc:
    """The board's document: the folded state plus every update after it."""
    doc = empty_doc()
    state = db.scalar(select(Board.state).where(Board.id == board.id))
    if state:
        doc.apply_update(state)
    for data in db.scalars(
        select(BoardUpdate.data).where(BoardUpdate.board_id == board.id).order_by(BoardUpdate.seq)
    ):
        doc.apply_update(data)
    return doc


def _write_picture(board: Board, doc: Doc) -> None:
    picture = snapshot_of(doc)
    board.snapshot = picture
    board.item_count = len(picture["items"])
    board.words = words_of(board.title, picture)


def create(db: Session, account: Account, space_id: int, title: str, content: dict[str, Any] | None = None) -> Board:
    doc = doc_from_json(content)
    state = doc.get_update()
    if len(state) > MAX_STATE:
        raise BoardError("too_large", "This board is too large.", 413)
    board = Board(id=new_id(), space_id=space_id, title=clean_title(title), created_by=account.id,
                  updated_by=account.name, state=state)
    _write_picture(board, doc)
    db.add(board)
    db.commit()
    logger.info("Board created id=%s space=%s items=%s by=%s", board.id, space_id, board.item_count, account.name)
    return board


def store_update(db: Session, board_id: str, data: bytes, by: str) -> int:
    """One update from a browser, kept at once. Returns how many wait to be folded."""
    db.add(BoardUpdate(board_id=board_id, data=data))
    board = db.get(Board, board_id)
    if board is not None:
        board.updated_at = utcnow()
        board.updated_by = by
    db.commit()
    return int(db.scalar(select(func.count()).select_from(BoardUpdate).where(BoardUpdate.board_id == board_id)) or 0)


def fold(db: Session, board_id: str, doc: Doc, authors: set[str] | None = None) -> None:
    """The waiting updates into the state, the picture anew, and a version when one is due. ``doc`` must hold every
    update stored so far (the live room's document, or one just loaded)."""
    with lock_for(board_id):
        board = db.get(Board, board_id)
        if board is None:
            return
        last_seq = db.scalar(select(func.max(BoardUpdate.seq)).where(BoardUpdate.board_id == board_id))
        state = doc.get_update()
        board.state = state
        if last_seq is not None:
            board.folded_seq = int(last_seq)
            db.execute(delete(BoardUpdate).where(BoardUpdate.board_id == board_id, BoardUpdate.seq <= last_seq))
        _write_picture(board, doc)
        _keep_version(db, board, state, authors or set())
        db.commit()


def _keep_version(db: Session, board: Board, state: bytes, authors: set[str]) -> None:
    newest = db.scalar(select(BoardVersion).where(BoardVersion.board_id == board.id).order_by(BoardVersion.id.desc()))
    if newest is not None and utcnow() - newest.created_at < VERSION_EVERY:
        newest.authors = ", ".join(sorted(set(filter(None, newest.authors.split(", "))) | authors))[:500]
        return
    db.add(BoardVersion(board_id=board.id, authors=", ".join(sorted(authors))[:500], state=state,
                        item_count=board.item_count))
    db.flush()
    _thin_versions(db, board.id)


def _thin_versions(db: Session, board_id: str) -> None:
    rows = list(db.execute(
        select(BoardVersion.id, BoardVersion.created_at).where(BoardVersion.board_id == board_id)
        .order_by(BoardVersion.id.desc())
    ))
    if len(rows) <= VERSIONS_KEPT:
        return
    keep: set[int] = {row.id for row in rows[:VERSIONS_KEPT // 2]}
    days: set[str] = set()
    for row in rows[VERSIONS_KEPT // 2 :]:
        day = row.created_at.date().isoformat()
        if day not in days and len(keep) < VERSIONS_KEPT:
            keep.add(row.id)
            days.add(day)
    db.execute(delete(BoardVersion).where(BoardVersion.board_id == board_id, BoardVersion.id.not_in(keep)))


def fold_from_disk(db: Session, board_id: str) -> None:
    """Fold a board nobody has open: after a server stop, the updates of its last session wait still."""
    board = db.get(Board, board_id)
    if board is None:
        return
    fold(db, board_id, load(db, board))


def fold_leftovers(db: Session) -> int:
    """At the start: every board with updates still waiting."""
    waiting = list(db.scalars(select(BoardUpdate.board_id).distinct()))
    for board_id in waiting:
        try:
            fold_from_disk(db, board_id)
        except Exception:
            logger.exception("Folding a board at the start failed id=%s", board_id)
    return len(waiting)


def restore_version(db: Session, board: Board, version: BoardVersion) -> bytes:
    """The board's content as it was in the version, as an update the live room applies on top of the present. It
    replaces every item and line, so the restore itself can be undone with the versions too."""
    present = load(db, board)
    old = empty_doc()
    old.apply_update(db.scalar(select(BoardVersion.state).where(BoardVersion.id == version.id)) or b"")
    before = present.get_state()
    items = present.get("items", type=Map)
    lines = present.get("lines", type=Map)
    texts = present.get("texts", type=Map)
    old_items = old.get("items", type=Map).to_py() or {}
    old_lines = old.get("lines", type=Map).to_py() or {}
    old_texts = old.get("texts", type=Map).to_py() or {}
    meta = present.get("meta", type=Map)
    defs = present.get("defs", type=Map)
    old_defs = old.get("defs", type=Map).to_py() or {}
    old_background = (old.get("meta", type=Map).to_py() or {}).get("background")
    with present.transaction():
        # Shapes the old state used come back with it; the ones added since stay, a board may show them again.
        for key, value in old_defs.items():
            if key not in defs:
                defs[key] = value
        if old_background is None:
            if "background" in meta:
                del meta["background"]
        elif meta.to_py().get("background") != old_background:
            meta["background"] = old_background
        for key in list(items.keys()):
            if key not in old_items:
                del items[key]
        for key, value in old_items.items():
            items[key] = value
        for key in list(lines.keys()):
            if key not in old_lines:
                del lines[key]
        for key, value in old_lines.items():
            lines[key] = value
        for key in list(texts.keys()):
            if key not in old_texts:
                del texts[key]
        for key, value in old_texts.items():
            if not isinstance(value, str):
                continue
            current = texts.get(key)
            if isinstance(current, Text) and str(current) == value:
                continue
            texts[key] = Text(value)
    return present.get_update(before)


def copy_content(db: Session, board: Board) -> dict[str, Any]:
    return snapshot_of(load(db, board))

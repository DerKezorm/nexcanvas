"""What nobody needs any more, once a day: boards and spaces 30 days in the bin, and photos and files no board
points at (in its present, its bin or its versions) for a day or longer."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from pycrdt import Doc, Map
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Board, BoardVersion, Media, Space, utcnow
from . import boards, media_store

logger = logging.getLogger("nexcanvas.cleanup")

BIN_DAYS = 30
#: A photo just uploaded is not on a board yet (the board's update is on its way); it waits a day.
ORPHAN_HOURS = 24
INTERVAL_SECONDS = 6 * 3600


def _media_ids(content: dict) -> set[str]:
    found = set()
    for item in content.get("items", []):
        value = item.get("media")
        if isinstance(value, str):
            found.add(value)
    return found


def used_media(space_id: int) -> set[str]:
    """Every media id a board of the space points at, now, in the bin or in a version."""
    used: set[str] = set()
    with SessionLocal() as db:
        for board in db.scalars(select(Board).where(Board.space_id == space_id)):
            used |= _media_ids(boards.copy_content(db, board))
            for state in db.scalars(select(BoardVersion.state).where(BoardVersion.board_id == board.id)):
                doc = Doc()
                doc.apply_update(state)
                for value in (doc.get("items", type=Map).to_py() or {}).values():
                    if isinstance(value, dict) and isinstance(value.get("media"), str):
                        used.add(value["media"])
    return used


def run_once() -> None:
    now = utcnow()
    with SessionLocal() as db:
        for board in db.scalars(select(Board).where(Board.deleted_at < now - timedelta(days=BIN_DAYS))):
            db.delete(board)
            logger.info("Board deleted after 30 days in the bin id=%s", board.id)
        for space in db.scalars(select(Space).where(Space.deleted_at < now - timedelta(days=BIN_DAYS))):
            db.delete(space)
            logger.info("Space deleted after 30 days in the bin id=%s", space.id)
        db.commit()
        spaces = set(db.scalars(select(Media.space_id).distinct()))
    for space_id in spaces:
        used = used_media(space_id)
        with SessionLocal() as db:
            old = db.scalars(select(Media).where(
                Media.space_id == space_id, Media.created_at < now - timedelta(hours=ORPHAN_HOURS)
            ))
            for row in old:
                if row.id not in used:
                    media_store.path_of(row.id).unlink(missing_ok=True)
                    media_store.preview_of(row.id).unlink(missing_ok=True)
                    db.delete(row)
                    logger.info("Media nobody uses removed id=%s", row.id)
            db.commit()
    # Files of spaces deleted above (their rows went with the space).
    with SessionLocal() as db:
        known = set(db.scalars(select(Media.id)))
    for path in media_store.root().iterdir():
        owner = path.name.removesuffix(".p")
        if path.is_file() and not path.name.startswith(".") and owner not in known:
            path.unlink(missing_ok=True)


async def run_forever(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=INTERVAL_SECONDS)
            return
        except TimeoutError:
            pass
        try:
            await asyncio.to_thread(run_once)
        except Exception:
            logger.exception("Cleaning up failed")

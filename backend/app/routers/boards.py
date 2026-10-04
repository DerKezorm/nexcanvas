"""Boards over HTTP, and the live connection to one.

The content of a board travels over the WebSocket (``services/live.py``); these routes are for everything around
it: the overview, making, renaming, moving, copying, the bin, favourites, versions and the search.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import PurePosixPath
from typing import Annotated, Any
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Query, Request, Response, WebSocket
from fastapi import Path as PathParam
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.requests import ClientDisconnect

from ..db import SessionLocal
from ..deps import Account, DbSession
from ..errors import error
from ..models import MANAGE, READ, WRITE, Board, BoardVersion, Favorite, Share, Visit, utcnow
from ..models import Account as AccountRow
from ..security import SESSION_COOKIE, session_account
from ..services import boards, canvas_file, live, media_store, rights, settings_service, totp

logger = logging.getLogger("nexcanvas.boards")

router = APIRouter(prefix="/api", tags=["boards"])

BoardId = Annotated[str, PathParam(min_length=6, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")]

#: Items of a board shown in the overview's little picture; a giant board shows its first ones.
PICTURE_ITEMS = 400


class BoardIn(BaseModel):
    space_id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=400)
    #: Items and lines to start with (a template, a copy, an import), as plain JSON.
    content: dict[str, Any] | None = None


class BoardChange(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=400)
    space_id: int | None = Field(default=None, ge=1)


class CopyIn(BaseModel):
    title: str = Field(min_length=1, max_length=400)
    space_id: int | None = Field(default=None, ge=1)


class FavoriteIn(BaseModel):
    on: bool


def _fail(exc: rights.RightsError | boards.BoardError) -> Exception:
    return error(exc.code, exc.text, exc.status)


def _board(db: DbSession, account: AccountRow, board_id: str, need: str, *, deleted: bool = False) -> Board:
    try:
        return rights.board_for(db, account, board_id, need, deleted=deleted)
    except rights.RightsError as exc:
        raise _fail(exc) from exc


def _picture(db: DbSession, board: Board) -> dict[str, Any]:
    current = live.picture(board.id)
    if current is None:
        current = db.scalar(select(Board.snapshot).where(Board.id == board.id)) or {"items": [], "lines": []}
    if len(current.get("items", [])) > PICTURE_ITEMS:
        shorter: dict[str, Any] = {"items": current["items"][:PICTURE_ITEMS], "lines": []}
        if "background" in current:
            shorter["background"] = current["background"]
        current = shorter
    return current


def _view(db: DbSession, account: AccountRow, board: Board, *, picture: bool = True) -> dict[str, Any]:
    favorite = db.get(Favorite, (account.id, board.id)) is not None
    visit = db.get(Visit, (account.id, board.id))
    shared = db.scalar(select(Share.id).where(Share.board_id == board.id))
    view: dict[str, Any] = {
        "id": board.id,
        "space_id": board.space_id,
        "title": board.title,
        "created_at": board.created_at.isoformat(),
        "updated_at": board.updated_at.isoformat(),
        "updated_by": board.updated_by,
        "deleted_at": board.deleted_at.isoformat() if board.deleted_at else None,
        "items": board.item_count,
        "favorite": favorite,
        "opened_at": visit.opened_at.isoformat() if visit else None,
        "public": shared is not None,
        "role": rights.role_in(db, account, board.space_id),
    }
    if picture:
        view["picture"] = _picture(db, board)
    return view


@router.get("/boards", summary="The boards of every readable space, or of one, or those in the bin")
def listing(
    account: Account,
    db: DbSession,
    space: Annotated[int | None, Query(ge=1)] = None,
    deleted: bool = False,
) -> list[dict[str, Any]]:
    readable = rights.readable_ids(db, account)
    if deleted:
        # The bin: boards of spaces where the account may write (it may bring them back).
        readable = {sid for sid in readable if rights.at_least(rights.role_in(db, account, sid), WRITE)}
    if space is not None:
        readable &= {space}
    if not readable:
        return []
    query = select(Board).where(Board.space_id.in_(readable))
    query = query.where(Board.deleted_at.is_not(None) if deleted else Board.deleted_at.is_(None))
    rows = db.scalars(query.order_by(Board.updated_at.desc()))
    return [_view(db, account, board) for board in rows]


@router.post("/boards", status_code=201, summary="Make a board in a space where the own account may write")
def create(payload: BoardIn, account: Account, db: DbSession) -> dict[str, Any]:
    try:
        rights.check(db, account, payload.space_id, WRITE)
        board = boards.create(db, account, payload.space_id, payload.title, payload.content)
    except (rights.RightsError, boards.BoardError) as exc:
        raise _fail(exc) from exc
    db.add(Visit(account_id=account.id, board_id=board.id, opened_at=utcnow()))
    db.commit()
    return _view(db, account, board)


@router.get("/boards/{board_id}", summary="A board: name, place, rights, and its picture")
def read(board_id: BoardId, account: Account, db: DbSession) -> dict[str, Any]:
    return _view(db, account, _board(db, account, board_id, READ))


@router.patch("/boards/{board_id}", summary="Rename a board, or move it into another space")
def change(board_id: BoardId, payload: BoardChange, account: Account, db: DbSession) -> dict[str, Any]:
    board = _board(db, account, board_id, WRITE)
    try:
        if payload.title is not None:
            board.title = boards.clean_title(payload.title)
        if payload.space_id is not None and payload.space_id != board.space_id:
            # Moving takes it out of one circle of people and shows it to another: write in both.
            rights.check(db, account, payload.space_id, WRITE)
            board.space_id = payload.space_id
            # A public page belongs to the old space's decision; it does not travel along.
            for share in db.scalars(select(Share).where(Share.board_id == board.id)):
                db.delete(share)
    except (rights.RightsError, boards.BoardError) as exc:
        raise _fail(exc) from exc
    board.words = boards.words_of(board.title, board.snapshot or {})
    db.commit()
    return _view(db, account, board)


@router.post("/boards/{board_id}/copy", status_code=201, summary="A copy of the board, in the same or another space")
def copy(board_id: BoardId, payload: CopyIn, account: Account, db: DbSession) -> dict[str, Any]:
    board = _board(db, account, board_id, READ)
    target = payload.space_id or board.space_id
    try:
        rights.check(db, account, target, WRITE)
        if target != board.space_id:
            # Photos live in their space; a copy into another one would show them where they were never shared.
            raise boards.BoardError("copy_other_space", "Copies stay in the same space for now.", 409)
        content = live.picture(board.id) or boards.copy_content(db, board)
        copied = boards.create(db, account, target, payload.title, content)
    except (rights.RightsError, boards.BoardError) as exc:
        raise _fail(exc) from exc
    return _view(db, account, copied)


@router.delete("/boards/{board_id}", status_code=204, summary="Move a board into the bin")
async def trash(board_id: BoardId, account: Account) -> None:
    with SessionLocal() as db:
        board = _board(db, account, board_id, WRITE)
        board.deleted_at = utcnow()
        db.commit()
    await live.close_board(board_id)
    logger.info("Board in the bin id=%s by=%s", board_id, account.name)


@router.post("/boards/{board_id}/restore", summary="Bring a board back from the bin")
def restore(board_id: BoardId, account: Account, db: DbSession) -> dict[str, Any]:
    board = _board(db, account, board_id, WRITE, deleted=True)
    board.deleted_at = None
    db.commit()
    return _view(db, account, board)


@router.delete("/boards/{board_id}/purge", status_code=204, summary="Delete a board from the bin for good")
def purge(board_id: BoardId, account: Account, db: DbSession) -> None:
    board = _board(db, account, board_id, WRITE, deleted=True)
    db.delete(board)
    db.commit()
    logger.info("Board deleted for good id=%s by=%s", board_id, account.name)


@router.put("/boards/{board_id}/favorite", summary="Star a board, or take the star away")
def favorite(board_id: BoardId, payload: FavoriteIn, account: Account, db: DbSession) -> dict[str, bool]:
    _board(db, account, board_id, READ)
    row = db.get(Favorite, (account.id, board_id))
    if payload.on and row is None:
        db.add(Favorite(account_id=account.id, board_id=board_id))
    elif not payload.on and row is not None:
        db.delete(row)
    db.commit()
    return {"favorite": payload.on}


@router.post("/boards/{board_id}/visit", status_code=204, summary="The own account opened the board just now")
def visit(board_id: BoardId, account: Account, db: DbSession) -> None:
    _board(db, account, board_id, READ)
    row = db.get(Visit, (account.id, board_id))
    if row is None:
        db.add(Visit(account_id=account.id, board_id=board_id, opened_at=utcnow()))
    else:
        row.opened_at = utcnow()
    db.commit()


@router.get("/boards/{board_id}/versions", summary="Earlier states of a board, newest first")
def versions(board_id: BoardId, account: Account, db: DbSession) -> list[dict[str, Any]]:
    _board(db, account, board_id, READ)
    rows = db.scalars(select(BoardVersion).where(BoardVersion.board_id == board_id).order_by(BoardVersion.id.desc()))
    return [
        {"id": row.id, "created_at": row.created_at.isoformat(), "authors": row.authors, "items": row.item_count}
        for row in rows
    ]


@router.post("/boards/{board_id}/versions/{version_id}/restore", summary="Bring an earlier state back")
async def restore_version(board_id: BoardId, version_id: Annotated[int, PathParam(ge=1)], account: Account) -> None:
    with SessionLocal() as db:
        board = _board(db, account, board_id, WRITE)
        version = db.get(BoardVersion, version_id)
        if version is None or version.board_id != board.id:
            raise error("not_found", "Not found.", 404)
        room = live.room_of(board_id)
        if room is not None:
            # The room's document is newer than anything stored folded: fold first, so the restore sees it.
            async with room.lock:
                boards.fold(db, board_id, room.doc, set(room.authors))
                room.waiting = 0
        update = boards.restore_version(db, board, version)
    await live.push(board_id, update, account.name)
    logger.info("Version brought back board=%s version=%s by=%s", board_id, version_id, account.name)


@router.get("/boards/{board_id}/export", response_model=None, summary="The board as JSON Canvas (.zip with its files)")
def export_canvas(board_id: BoardId, account: Account, db: DbSession) -> Response:
    board = _board(db, account, board_id, READ)
    picture = live.picture(board_id) or boards.snapshot_of(boards.load(db, board))
    data, name, media_type = canvas_file.export(db, board, picture)
    logger.info("Board exported as canvas id=%s items=%s by=%s", board_id, len(picture.get("items", [])), account.name)
    return Response(data, media_type=media_type, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


async def _canvas_body(request: Request) -> bytes:
    """The file of an import, read to its end within the limit."""
    with SessionLocal() as db:
        # An archive holds several photos; it may be a few times as large as one upload.
        limit = media_store.max_bytes(db) * 4
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise error("too_large", "The file is larger than allowed.", 413, max_mb=limit // (1024 * 1024))
    body = bytearray()
    try:
        async for chunk in request.stream():
            body += chunk
            if len(body) > limit:
                raise error("too_large", "The file is larger than allowed.", 413, max_mb=limit // (1024 * 1024))
    except ClientDisconnect as exc:
        raise error("upload_aborted", "The upload stopped before the end.") from exc
    if not body:
        raise error("empty", "The file is empty.")
    return bytes(body)


def _imported(result: canvas_file.Imported) -> dict[str, Any]:
    return {"items": result.items, "lines": result.lines, "files": result.files, "missing": result.missing[:50],
            "skipped": result.skipped}


@router.post("/boards/from-file", status_code=201,
             summary="A new board from a JSON Canvas (.canvas or .zip), as another nexcanvas or Obsidian wrote it")
async def board_from_file(
    request: Request,
    account: Account,
    space_id: Annotated[int, Query(ge=1, le=2**31)],
    name: Annotated[str, Query(max_length=255)] = "",
    title: Annotated[str, Query(max_length=200)] = "",
) -> dict[str, Any]:
    with SessionLocal() as db:
        try:
            rights.check(db, account, space_id, WRITE)
        except rights.RightsError as exc:
            raise _fail(exc) from exc
    body = await _canvas_body(request)

    def bring_in() -> tuple[str, bytes, canvas_file.Imported]:
        with SessionLocal() as db:
            stem = PurePosixPath(name.replace("\\", "/")).name.rsplit(".", 1)[0].strip()
            # A name typed in the dialog first, then the one the file carries, then the file's own.
            chosen = title.strip() or canvas_file.title_of(body) or stem or "Imported board"
            board = boards.create(db, account, space_id, chosen)
            try:
                update, result = canvas_file.import_into(db, account, board, body, (0.0, 0.0))
            except canvas_file.CanvasError:
                # Nothing to bring in: no empty board is left behind.
                db.delete(board)
                db.commit()
                raise
            db.add(Visit(account_id=account.id, board_id=board.id, opened_at=utcnow()))
            db.commit()
            return board.id, update, result

    try:
        board_id, update, result = await run_in_threadpool(bring_in)
    except canvas_file.CanvasError as exc:
        raise error(exc.code, exc.text, exc.status) from exc
    except boards.BoardError as exc:
        raise _fail(exc) from exc
    await live.push(board_id, update, account.name)
    logger.info("Board made from a canvas board=%s space=%s items=%s lines=%s files=%s by=%s", board_id, space_id,
                result.items, result.lines, result.files, account.name)
    with SessionLocal() as db:
        board = _board(db, account, board_id, READ)
        return {"board": _view(db, account, board), **_imported(result)}


@router.post("/boards/{board_id}/import", summary="Cards and arrows of a JSON Canvas (.canvas or .zip) onto the board")
async def import_canvas(
    board_id: BoardId,
    request: Request,
    account: Account,
    x: Annotated[float, Query(ge=-1e7, le=1e7)] = 0,
    y: Annotated[float, Query(ge=-1e7, le=1e7)] = 0,
) -> dict[str, Any]:
    with SessionLocal() as db:
        _board(db, account, board_id, WRITE)
    body = await _canvas_body(request)

    def bring_in() -> tuple[bytes, canvas_file.Imported]:
        with SessionLocal() as db:
            board = _board(db, account, board_id, WRITE)
            return canvas_file.import_into(db, account, board, body, (x, y))

    try:
        update, result = await run_in_threadpool(bring_in)
    except canvas_file.CanvasError as exc:
        raise error(exc.code, exc.text, exc.status) from exc
    await live.push(board_id, update, account.name)
    logger.info("Canvas imported board=%s items=%s lines=%s files=%s missing=%s by=%s", board_id, result.items,
                result.lines, result.files, len(result.missing), account.name)
    return _imported(result)


@router.get("/search", summary="Boards whose name or words contain all the words asked for")
def search(account: Account, db: DbSession, q: Annotated[str, Query(min_length=1, max_length=200)]) -> list[dict]:
    words = [word for word in q.casefold().split() if word][:8]
    readable = rights.readable_ids(db, account)
    if not words or not readable:
        return []
    query = select(Board).where(Board.space_id.in_(readable), Board.deleted_at.is_(None))
    for word in words:
        escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(Board.words.like(f"%{escaped}%", escape="\\"))
    rows = db.scalars(query.order_by(Board.updated_at.desc()).limit(50))
    return [_view(db, account, board, picture=False) for board in rows]


# --- Live ------------------------------------------------------------------------------------------------------------


def _origin_ok(socket: WebSocket) -> bool:
    """The page that opens the connection must be nexcanvas itself. A WebSocket knows no CORS: without this a page on
    another site could open one with the visitor's cookie (``SameSite=Lax`` keeps it out today, this is the second
    wall). Behind a proxy the host may arrive as ``X-Forwarded-Host``."""
    origin = socket.headers.get("origin")
    if not origin:
        return True
    host = urlsplit(origin).netloc.lower()
    allowed = {socket.headers.get("host", "").lower(), socket.headers.get("x-forwarded-host", "").lower()}
    with SessionLocal() as db:
        public = settings_service.public_url(db)
    if public:
        allowed.add(urlsplit(public).netloc.lower())
    return bool(host) and host in allowed


@router.websocket("/boards/{board_id}/live")
async def live_socket(socket: WebSocket, board_id: str) -> None:
    if not _origin_ok(socket):
        await socket.close(code=live.CLOSE_FORBIDDEN)
        return
    with SessionLocal() as db:
        account = session_account(db, socket.cookies.get(SESSION_COOKIE))
        board = db.get(Board, board_id) if len(board_id) <= 24 else None
        role = None
        if (account is not None and board is not None and board.deleted_at is None
                and not totp.setup_required(db, account)):
            role = rights.role_in(db, account, board.space_id)
        if account is not None:
            db.expunge(account)
    if account is None or not rights.at_least(role, READ):
        await socket.close(code=live.CLOSE_FORBIDDEN)
        return
    await socket.accept()
    try:
        token = socket.cookies.get(SESSION_COOKIE, "")
        await live.serve(socket, board_id, account, rights.at_least(role, WRITE), token)
    except Exception as exc:
        if type(exc).__name__ not in ("WebSocketDisconnect", "ClientDisconnected", "CancelledError"):
            logger.exception("Live connection failed board=%s", board_id)
    finally:
        await asyncio.sleep(0)


__all__ = ["MANAGE", "datetime", "router"]

"""The API for programs (``/api/v1``): nexdeck, n8n, scripts. An API token in ``Authorization: Bearer``. Reading only.

**The promise.** What is under ``/api/v1`` stays as it is: new fields may come, nothing is renamed or taken away. A
change that would break a program goes to ``/api/v2`` beside it. ``docs/api.md`` describes every route.

Walls, in this order: a request that carries an ``Origin`` is refused (browsers send one, programs do not; no web page
can use a token it found); API tokens must be switched on by the operator; the token must be valid; the token must stay
under its rate. The session cookie counts for nothing here.

A token reads with the rights of its account, limited to its spaces: a space or board it may not read answers like one
that does not exist. Nothing here changes a board (design answer 03.10.2026: reading only).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy import func, select

from .. import __version__
from ..db import SessionLocal
from ..errors import error
from ..models import READ, Board, Space, utcnow
from ..services import apitokens, boards, live, logs, picture, rights, settings_service
from ..services.apitokens import Caller

logger = logging.getLogger("nexcanvas.api")

router = APIRouter(prefix="/api/v1", tags=["api v1"])

BoardId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{6,40}$")]


def _token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header[:7].lower() == "bearer " else None


def caller(request: Request) -> Caller:
    if request.headers.get("origin"):
        raise error("origin_refused", "The API is for programs, not web pages.", 403)
    with SessionLocal() as db:
        if not apitokens.allowed(db):
            raise error("api_off", "The operator has not switched API tokens on.", 401)
        found = apitokens.authenticate(db, _token(request))
    if found is None:
        raise error("token_invalid", "No valid API token.", 401)
    if not apitokens.brake(found.token_id):
        exc = error("slow_down", "Too many requests with this token. Wait a minute.", 429)
        exc.headers = {"Retry-After": "60"}
        raise exc
    logs.set_actor(found.account.name)
    return found


Reader = Annotated[Caller, Depends(caller)]


def _link(request: Request, db: Any, board_id: str) -> str:
    base = settings_service.public_url(db) or str(request.base_url).rstrip("/")
    return f"{base}/b/{board_id}"


def _board(request: Request, db: Any, board: Board, spaces: dict[int, str]) -> dict[str, Any]:
    return {
        "id": board.id,
        "title": board.title,
        "space_id": board.space_id,
        "space": spaces.get(board.space_id, ""),
        "created_at": board.created_at.isoformat(),
        "updated_at": board.updated_at.isoformat(),
        "updated_by": board.updated_by,
        "items": board.item_count,
        "url": _link(request, db, board.id),
        "picture": f"/api/v1/boards/{board.id}/picture.svg",
    }


def _readable(db: Any, found: Caller) -> dict[int, str]:
    """The spaces the token may read, by id, with their names."""
    ids = rights.readable_ids(db, found.account)
    if not ids:
        return {}
    return dict(db.execute(select(Space.id, Space.name).where(Space.id.in_(ids))).all())


def _found(db: Any, found: Caller, board_id: str) -> Board:
    try:
        return rights.board_for(db, found.account, board_id, READ)
    except rights.RightsError as exc:
        raise error(exc.code, exc.text, exc.status) from exc


@router.get("/me", summary="Who the token speaks for, and what it may")
def me(found: Reader) -> dict[str, Any]:
    with SessionLocal() as db:
        spaces = _readable(db, found)
    return {
        "name": found.account.name,
        "display_name": found.account.display_name,
        "level": found.level,
        "spaces": sorted(spaces.values()),
        "version": __version__,
    }


@router.get("/spaces", summary="The spaces the token may read, with how many boards each holds")
def spaces(found: Reader) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        names = _readable(db, found)
        if not names:
            return []
        counts = dict(db.execute(
            select(Board.space_id, func.count()).where(Board.space_id.in_(names), Board.deleted_at.is_(None))
            .group_by(Board.space_id)
        ).all())
        colours = dict(db.execute(select(Space.id, Space.color).where(Space.id.in_(names))).all())
        return [
            {"id": space_id, "name": name, "color": colours.get(space_id, ""), "boards": int(counts.get(space_id, 0)),
             "role": rights.role_in(db, found.account, space_id)}
            for space_id, name in sorted(names.items(), key=lambda pair: pair[1].casefold())
        ]


@router.get("/boards", summary="Boards the token may read, the ones changed last first")
def board_list(
    found: Reader,
    request: Request,
    space: Annotated[int | None, Query(ge=1, le=2**31)] = None,
    order: Literal["updated", "title"] = "updated",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        names = _readable(db, found)
        wanted = set(names) if space is None else ({space} & set(names))
        if not wanted:
            # A space the token may not read answers like an empty one... unless it was asked for by name: not found.
            if space is not None:
                raise error("not_found", "Not found.", 404)
            return []
        query = select(Board).where(Board.space_id.in_(wanted), Board.deleted_at.is_(None))
        query = query.order_by(Board.updated_at.desc() if order == "updated" else func.lower(Board.title))
        return [_board(request, db, board, names) for board in db.scalars(query.limit(limit))]


@router.get("/boards/{board_id}", summary="One board: name, space, when it changed, how many things are on it")
def board_one(board_id: BoardId, found: Reader, request: Request) -> dict[str, Any]:
    with SessionLocal() as db:
        board = _found(db, found, board_id)
        return _board(request, db, board, _readable(db, found))


@router.get("/boards/{board_id}/picture.svg", response_class=Response,
            summary="The board as a small picture (SVG), in the dark or light look of the app")
def board_picture(
    board_id: BoardId,
    found: Reader,
    look: Literal["dark", "light"] = "dark",
    width: Annotated[int, Query(ge=120, le=1600)] = 480,
) -> Response:
    with SessionLocal() as db:
        board = _found(db, found, board_id)
        shown = live.picture(board.id) or boards.snapshot_of(boards.load(db, board))
        title = board.title
    return Response(picture.svg(shown, title, look, width), media_type="image/svg+xml", headers={
        # Nothing in it runs, and nothing it might hold could load anything.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=30",
    })


@router.get("/dashboard", summary="Numbers for a dashboard card: boards, changed today and this week, the last ones")
def dashboard(found: Reader, request: Request) -> dict[str, Any]:
    with SessionLocal() as db:
        names = _readable(db, found)
        if not names:
            return {"spaces": 0, "boards": 0, "changed_today": 0, "changed_week": 0, "recent": []}
        live_boards = select(Board).where(Board.space_id.in_(names), Board.deleted_at.is_(None))
        now = utcnow()
        # Today as the server's clock has it: from its midnight on.
        local = datetime.now().astimezone()
        midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
        since_midnight = now - (local - midnight)

        def count(after: datetime | None = None) -> int:
            query = select(func.count()).select_from(live_boards.subquery())
            if after is not None:
                query = select(func.count()).select_from(live_boards.where(Board.updated_at >= after).subquery())
            return int(db.scalar(query) or 0)

        recent = db.scalars(live_boards.order_by(Board.updated_at.desc()).limit(5))
        return {
            "spaces": len(names),
            "boards": count(),
            "changed_today": count(since_midnight),
            "changed_week": count(now - timedelta(days=7)),
            "recent": [_board(request, db, board, names) for board in recent],
        }

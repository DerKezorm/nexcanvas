"""Public read-only pages of boards, as nexlore's shares.

* **Closed until the operator opens it** (``shares_allowed``); only managers of the space switch a page on.
* **The link is the key**: a long random token, kept so it can be copied again; it opens this one board only.
* **An end date and a password** can be set; a wrong password counts on a brake per page and sender.
* **Only what is on the board leaves**: the picture of the board, and the photos and files its items name. A media
  id of the same space that is not on this board answers like one that does not exist.
* **The password is asked once** per browser: the answer sets a cookie for this page alone, signed with the
  server's secret, so a guesser cannot make one.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import get_settings
from ..db import SessionLocal
from ..deps import Account, DbSession, client_ip
from ..errors import detail, error
from ..models import MANAGE, Board, Media, Share, utcnow
from ..security import Brake, hash_password, verify_password
from ..services import live, rights, settings_service
from .media import deliver

logger = logging.getLogger("nexcanvas.shares")

router = APIRouter(prefix="/api", tags=["shares"])

BoardId = Annotated[str, PathParam(min_length=6, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")]
Token = Annotated[str, PathParam(min_length=20, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
MediaId = Annotated[str, PathParam(min_length=8, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]
COOKIE = "nexcanvas_page"
#: Wrong passwords per page and sender before a pause, and per page from anywhere.
_brake = Brake()


class ShareIn(BaseModel):
    #: Days until the page closes; None: never.
    days: int | None = Field(default=30, ge=1, le=3650)
    #: Empty keeps the password there is (or none); a new one replaces it.
    password: str = Field(default="", max_length=200)
    #: Removes the password.
    no_password: bool = False


class UnlockIn(BaseModel):
    password: str = Field(max_length=200)


def _link(db: DbSession, request: Request, token: str) -> str:
    base = settings_service.public_url(db) or str(request.base_url).rstrip("/")
    return f"{base}/s/{token}"


def _view(db: DbSession, request: Request, share: Share) -> dict[str, Any]:
    return {
        "link": _link(db, request, share.token),
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "password": bool(share.password_hash),
    }


def _managed_board(db: DbSession, account: Any, board_id: str) -> Board:
    try:
        return rights.board_for(db, account, board_id, MANAGE)
    except rights.RightsError as exc:
        raise error(exc.code, exc.text, exc.status) from exc


@router.get("/boards/{board_id}/share", summary="The public page of a board; null while it has none")
def read_share(board_id: BoardId, request: Request, account: Account, db: DbSession) -> dict[str, Any] | None:
    try:
        board = rights.board_for(db, account, board_id, rights.READ)
    except rights.RightsError as exc:
        raise error(exc.code, exc.text, exc.status) from exc
    share = db.scalar(select(Share).where(Share.board_id == board.id))
    # No public page is the usual state of a board, not an error.
    if share is None:
        return None
    return _view(db, request, share)


@router.put("/boards/{board_id}/share", summary="Put a board on a public page, or change its end and password")
def put_share(board_id: BoardId, payload: ShareIn, request: Request, account: Account, db: DbSession) -> dict:
    if not settings_service.get(db, "shares_allowed"):
        raise error("shares_off", "The operator has not allowed public pages.", 403)
    board = _managed_board(db, account, board_id)
    share = db.scalar(select(Share).where(Share.board_id == board.id))
    if share is None:
        share = Share(token=secrets.token_urlsafe(24), board_id=board.id, space_id=board.space_id,
                      created_by=account.id)
        db.add(share)
    share.expires_at = utcnow() + timedelta(days=payload.days) if payload.days else None
    if payload.no_password:
        share.password_hash = ""
    elif payload.password:
        share.password_hash = hash_password(payload.password)
    db.commit()
    guarded = bool(share.password_hash)
    logger.info("Public page set board=%s ends=%s guarded=%s by=%s", board.id, payload.days or "-", guarded,
                account.name)
    return _view(db, request, share)


@router.delete("/boards/{board_id}/share", status_code=204, summary="Take a board off its public page")
def delete_share(board_id: BoardId, account: Account, db: DbSession) -> None:
    board = _managed_board(db, account, board_id)
    for share in db.scalars(select(Share).where(Share.board_id == board.id)):
        db.delete(share)
    db.commit()


# --- The page itself, without signing in ----------------------------------------------------------------------------


def _open_share(db: Any, token: str) -> tuple[Share, Board]:
    """The share and its board, or the one answer for everything that is not a page any more."""
    share = db.scalar(select(Share).where(Share.token == token))
    board = db.get(Board, share.board_id) if share is not None else None
    if (
        share is None or board is None or board.deleted_at is not None
        or not settings_service.get(db, "shares_allowed")
        or (share.expires_at is not None and share.expires_at <= utcnow())
    ):
        raise error("not_found", "Not found.", 404)
    return share, board


def _pass(share: Share) -> str:
    key = get_settings().resolved_secret_key().encode()
    return hmac.new(key, f"page:{share.id}:{share.password_hash}".encode(), hashlib.sha256).hexdigest()


def _unlocked(request: Request, share: Share) -> bool:
    return not share.password_hash or hmac.compare_digest(request.cookies.get(COOKIE, ""), _pass(share))


def _picture(db: Any, board: Board) -> dict[str, Any]:
    current = live.picture(board.id)
    if current is None:
        current = db.scalar(select(Board.snapshot).where(Board.id == board.id)) or {"items": [], "lines": []}
    return current


def _page(db: Any, share: Share, board: Board) -> dict[str, Any]:
    return {"title": board.title, "picture": _picture(db, board), "token": share.token}


@router.get("/public/{token}", summary="A public page (no sign-in): its board, or that it needs a password")
def public_page(token: Token, request: Request) -> dict[str, Any]:
    with SessionLocal() as db:
        share, board = _open_share(db, token)
        if not _unlocked(request, share):
            return {"password": True, "title": ""}
        return _page(db, share, board)


@router.post("/public/{token}", summary="Open a public page with its password")
def unlock(token: Token, payload: UnlockIn, request: Request, response: Response) -> dict[str, Any]:
    with SessionLocal() as db:
        share, board = _open_share(db, token)
        key = f"page:{share.id}:{client_ip(request)}"
        wait = _brake.wait_seconds(key)
        if wait:
            raise HTTPException(
                status_code=429,
                detail=detail("too_many_attempts", "Too many attempts. Try again later.", retry_after=wait),
                headers={"Retry-After": str(wait)},
            )
        if share.password_hash and not verify_password(payload.password, share.password_hash):
            _brake.failed(key)
            raise error("wrong_password", "The password is wrong.", 401)
        _brake.succeeded(key)
        response.set_cookie(COOKIE, _pass(share), httponly=True, samesite="lax", path=f"/api/public/{share.token}",
                            secure=request.url.scheme == "https")
        return _page(db, share, board)


@router.get("/public/{token}/media/{media_id}", response_model=None, summary="A photo or file of a public page")
def public_media(token: Token, media_id: MediaId, request: Request, download: bool = False,
                 preview: bool = False) -> Response:
    with SessionLocal() as db:
        share, board = _open_share(db, token)
        if not _unlocked(request, share):
            raise error("not_found", "Not found.", 404)
        named = {item.get("media") for item in _picture(db, board).get("items", [])}
        row = db.get(Media, media_id)
        if row is None or media_id not in named or row.space_id != board.space_id:
            raise error("not_found", "Not found.", 404)
        db.expunge(row)
    return deliver(row, request, download, preview)


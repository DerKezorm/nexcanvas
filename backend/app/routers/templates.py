"""Own templates (block 5): a board kept as a starting point, for one space by whoever manages it, or for the whole
server by the operator.

Everybody who may read a space sees its templates and the server's; nobody sees those of a space they may not read.
What comes in, from a board or from a file, goes through the same checks as the content of a new board
(``services/boards``): known kinds of items and well-formed ids only, a background the page knows, shapes of packages
checked as packages are.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import Account, DbSession
from ..errors import error
from ..models import MANAGE, OPERATOR, READ, BoardTemplate, utcnow
from ..models import Account as AccountRow
from ..services import boards, rights

logger = logging.getLogger("nexcanvas.templates")

router = APIRouter(prefix="/api/board-templates", tags=["templates"])

#: A template is a board; one this large is no starting point any more.
MAX_BYTES = 4_000_000
MAX_PER_SCOPE = 100


class TemplateIn(BaseModel):
    #: The space it is for; left out: the whole server (operator).
    space: int | None = None
    name: str = Field(min_length=1, max_length=120)
    content: dict[str, Any]


class TemplateChange(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _view(row: BoardTemplate) -> dict[str, Any]:
    return {
        "key": row.id,
        "scope": "space" if row.space_id is not None else "server",
        "space": row.space_id,
        "name": row.name,
        "content": row.content,
        "updated_at": row.updated_at,
    }


def _may_change(db: DbSession, account: AccountRow, space_id: int | None) -> None:
    if space_id is None:
        if account.role != OPERATOR or account.via_key:
            raise error("forbidden", "Only the operator keeps templates for the whole server.", 403)
        return
    try:
        rights.check(db, account, space_id, MANAGE)
    except rights.RightsError as exc:
        raise error(exc.code, exc.text, exc.status) from exc


def _row(db: DbSession, account: AccountRow, key: int) -> BoardTemplate:
    row = db.get(BoardTemplate, key)
    if row is None:
        raise error("not_found", "Not found.", 404)
    if row.space_id is not None and not rights.at_least(rights.role_in(db, account, row.space_id), READ):
        raise error("not_found", "Not found.", 404)
    return row


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned or any(ord(c) < 32 for c in cleaned):
        raise error("invalid_name", "A template needs a name.", 422)
    return cleaned


def _content(raw: dict[str, Any]) -> dict[str, Any]:
    """The content as kept: what a new board would take of it, nothing else."""
    if len(json.dumps(raw, ensure_ascii=False)) > MAX_BYTES:
        raise error("too_large", "This template is larger than 4 MB.", 413)
    return boards.snapshot_of(boards.doc_from_json(raw))


@router.get("", summary="The templates for a space: the server's and the space's own")
def templates(account: Account, db: DbSession, space: Annotated[int | None, Query()] = None) -> list[dict[str, Any]]:
    wanted = select(BoardTemplate).where(BoardTemplate.space_id.is_(None))
    if space is not None:
        if not rights.at_least(rights.role_in(db, account, space), READ):
            raise error("not_found", "Not found.", 404)
        wanted = select(BoardTemplate).where((BoardTemplate.space_id.is_(None)) | (BoardTemplate.space_id == space))
    return [_view(row) for row in db.scalars(wanted.order_by(BoardTemplate.name, BoardTemplate.id))]


@router.post("", status_code=201, summary="Keep a board as a template for a space or the server")
def keep(payload: TemplateIn, account: Account, db: DbSession) -> dict[str, Any]:
    _may_change(db, account, payload.space)
    scope = BoardTemplate.space_id.is_(None) if payload.space is None else BoardTemplate.space_id == payload.space
    if (db.scalar(select(func.count()).select_from(BoardTemplate).where(scope)) or 0) >= MAX_PER_SCOPE:
        raise error("too_many_templates", f"At most {MAX_PER_SCOPE} templates here.", 409)
    row = BoardTemplate(space_id=payload.space, name=_clean_name(payload.name), content=_content(payload.content),
                        created_by=account.id)
    db.add(row)
    db.commit()
    logger.info("Template kept key=%s space=%s items=%s by=%s", row.id, payload.space, len(row.content["items"]),
                account.name)
    return _view(row)


@router.put("/{key}", summary="Rename a template")
def rename(key: Annotated[int, PathParam(ge=1)], payload: TemplateChange, account: Account,
           db: DbSession) -> dict[str, Any]:
    row = _row(db, account, key)
    _may_change(db, account, row.space_id)
    row.name = _clean_name(payload.name)
    row.updated_at = utcnow()
    db.commit()
    return _view(row)


@router.delete("/{key}", status_code=204, summary="Remove a template; boards made from it stay")
def remove(key: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> None:
    row = _row(db, account, key)
    _may_change(db, account, row.space_id)
    db.delete(row)
    db.commit()
    logger.info("Template removed key=%s by=%s", key, account.name)


@router.get("/{key}/file", summary="The template as a file to pass on")
def download(key: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> Response:
    row = _row(db, account, key)
    body = json.dumps({"format": "nexcanvas-template", "version": 1, "name": row.name, "content": row.content},
                      ensure_ascii=False, indent=1)
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="nexcanvas-template-{row.id}.json"'})

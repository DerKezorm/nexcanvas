"""Shape packages (block 4): installed per space by whoever manages it, or for the whole server by the operator.

Everybody who may read a space sees its packages and the server's; nobody sees the packages of a space they may not
read, not even that there are any. Every package that comes in is checked by ``services/shapepacks`` and kept only as
checked.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from fastapi import Path as PathParam
from pydantic import BaseModel
from sqlalchemy import func, select

from ..deps import Account, DbSession
from ..errors import error
from ..models import MANAGE, OPERATOR, READ, ShapePackage, utcnow
from ..models import Account as AccountRow
from ..services import rights, shapepacks

logger = logging.getLogger("nexcanvas.shapes")

router = APIRouter(prefix="/api/shape-packages", tags=["shapes"])


class PackageIn(BaseModel):
    #: The space it is for; left out: the whole server (operator).
    space: int | None = None
    package: dict[str, Any]


class PackageChange(BaseModel):
    package: dict[str, Any] | None = None
    enabled: bool | None = None


def _view(row: ShapePackage) -> dict[str, Any]:
    return {
        "key": row.id,
        "id": f"p{row.id}",
        "scope": "space" if row.space_id is not None else "server",
        "space": row.space_id,
        "enabled": row.enabled,
        **row.data,
    }


def _may_change(db: DbSession, account: AccountRow, space_id: int | None) -> None:
    """Managing the space, or for the server's own packages being the operator; else the same answers as elsewhere."""
    if space_id is None:
        if account.role != OPERATOR or account.via_key:
            raise error("forbidden", "Only the operator installs packages for the whole server.", 403)
        return
    try:
        rights.check(db, account, space_id, MANAGE)
    except rights.RightsError as exc:
        raise error(exc.code, exc.text, exc.status) from exc


def _row(db: DbSession, account: AccountRow, key: int) -> ShapePackage:
    row = db.get(ShapePackage, key)
    if row is None:
        raise error("not_found", "Not found.", 404)
    if row.space_id is not None and not rights.at_least(rights.role_in(db, account, row.space_id), READ):
        raise error("not_found", "Not found.", 404)
    return row


def _checked(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        return shapepacks.check(raw)
    except shapepacks.PackError as exc:
        raise error("invalid_package", exc.text, 422, reason=exc.text) from exc


@router.get("", summary="The packages for a space: the server's and the space's own")
def packages(account: Account, db: DbSession, space: Annotated[int | None, Query()] = None) -> list[dict[str, Any]]:
    wanted = select(ShapePackage).where(ShapePackage.space_id.is_(None))
    if space is not None:
        if not rights.at_least(rights.role_in(db, account, space), READ):
            raise error("not_found", "Not found.", 404)
        wanted = select(ShapePackage).where((ShapePackage.space_id.is_(None)) | (ShapePackage.space_id == space))
    return [_view(row) for row in db.scalars(wanted.order_by(ShapePackage.id))]


@router.post("", status_code=201, summary="Install a package for a space or the server")
def install(payload: PackageIn, account: Account, db: DbSession) -> dict[str, Any]:
    _may_change(db, account, payload.space)
    data = _checked(payload.package)
    scope = ShapePackage.space_id.is_(None) if payload.space is None else ShapePackage.space_id == payload.space
    if (db.scalar(select(func.count()).select_from(ShapePackage).where(scope)) or 0) >= shapepacks.MAX_PER_SCOPE:
        raise error("too_many_packages", f"At most {shapepacks.MAX_PER_SCOPE} packages here.", 409)
    row = ShapePackage(space_id=payload.space, data=data, created_by=account.id)
    db.add(row)
    db.commit()
    logger.info("Shape package installed key=%s space=%s shapes=%s by=%s", row.id, payload.space, len(data["shapes"]),
                account.name)
    return _view(row)


@router.put("/{key}", summary="Replace a package, or switch it on or off")
def change(key: Annotated[int, PathParam(ge=1)], payload: PackageChange, account: Account,
           db: DbSession) -> dict[str, Any]:
    row = _row(db, account, key)
    _may_change(db, account, row.space_id)
    if payload.package is not None:
        row.data = _checked(payload.package)
    if payload.enabled is not None:
        row.enabled = payload.enabled
    row.updated_at = utcnow()
    db.commit()
    logger.info("Shape package changed key=%s by=%s", row.id, account.name)
    return _view(row)


@router.delete("/{key}", status_code=204, summary="Remove a package; shapes already on boards stay as they are")
def remove(key: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> None:
    row = _row(db, account, key)
    _may_change(db, account, row.space_id)
    db.delete(row)
    db.commit()
    logger.info("Shape package removed key=%s by=%s", key, account.name)


@router.get("/{key}/file", summary="The package as a file to pass on")
def download(key: Annotated[int, PathParam(ge=1)], account: Account, db: DbSession) -> Response:
    row = _row(db, account, key)
    body = json.dumps(shapepacks.file_of(row.data, f"p{row.id}"), ensure_ascii=False, indent=1)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="nexcanvas-shapes-{row.id}.json"'},
    )

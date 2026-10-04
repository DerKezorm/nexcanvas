"""Backups over HTTP; operator only."""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Request
from fastapi import Path as PathParam
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..db import SessionLocal
from ..deps import OperatorAccount, confirm_operator
from ..errors import error
from ..services import backups

logger = logging.getLogger("nexcanvas.backups")

router = APIRouter(prefix="/api/backups", tags=["backups"])
BackupName = Annotated[str, PathParam(max_length=64, pattern=backups.NAME.pattern)]


class CreateIn(BaseModel):
    note: str = Field(default="", max_length=200)


def _fail(exc: backups.BackupError) -> Exception:
    return error(exc.code, exc.text, 404 if exc.code == "not_found" else 400)


@router.get("")
def listing(_operator: OperatorAccount) -> list[dict[str, Any]]:
    return [asdict(entry) for entry in backups.entries()]


@router.post("", status_code=201)
def create(body: CreateIn, _operator: OperatorAccount) -> dict[str, str]:
    return {"name": backups.create(kind=backups.MANUAL, note=body.note).name}


@router.post("/{name}/check")
def check(name: BackupName, _operator: OperatorAccount) -> dict[str, Any]:
    try:
        brief = backups.check(name)
    except backups.BackupError as exc:
        raise _fail(exc) from exc
    return {**asdict(brief), "usable": brief.usable}


class PasswordIn(BaseModel):
    #: The operator's password once more; an account from a provider has none and needs none.
    password: str = Field(default="", max_length=200)


@router.post("/{name}/restore", status_code=202)
def restore(name: BackupName, body: PasswordIn, request: Request, operator: OperatorAccount) -> dict[str, Any]:
    """Checks, keeps the current state as a backup, and restarts; the restore happens at the next start. Asks for
    the password again: going back brings back old passwords and keys (review before 1.0.0)."""
    with SessionLocal() as db:
        # An older state would turn the connection back while nexsuite still holds the app (A9): disconnect first.
        from ..services import suite

        suite.refuse_if_managed(db)
        confirm_operator(request, db, operator, body.password)
    try:
        brief = backups.stage_restore(name)
    except backups.BackupError as exc:
        raise _fail(exc) from exc
    backups.restart_soon()
    return {**asdict(brief), "usable": brief.usable, "restarting": True}


class DownloadIn(BaseModel):
    #: The operator's password once more; an account from a provider has none and needs none.
    password: str = Field(default="", max_length=200)


@router.post("/{name}/download", summary="The archive itself, to keep a copy elsewhere; needs the password again")
def download(name: BackupName, body: DownloadIn, request: Request, operator: OperatorAccount) -> FileResponse:
    """The archive holds everything: the database, every note, ``secret.key``. A stolen session alone must not be
    enough to carry it away, so the password is asked again and counted like a sign-in."""
    with SessionLocal() as db:
        # The archive holds secret.key and the emergency account's password hash and second factor: connected, only
        # the emergency account carries it away (found when connecting nextasks, 04.10.2026).
        from ..services import suite

        suite.refuse_unless_keeper(db, operator, "backups_emergency_only",
                                   "While connected to nexsuite, only the emergency account handles backups.")
        confirm_operator(request, db, operator, body.password)
    try:
        path = backups.path_of(name)
    except backups.BackupError as exc:
        raise _fail(exc) from exc
    logger.warning("Backup downloaded name=%s by=%s", name, operator.name)
    return FileResponse(path, media_type="application/zip", filename=name,
                        headers={"Cache-Control": "no-store"})


@router.delete("/{name}", status_code=204)
def delete(name: BackupName, body: PasswordIn, request: Request, operator: OperatorAccount) -> None:
    """Asks for the password again: a stolen session must not throw every copy away (review before 1.0.0)."""
    with SessionLocal() as db:
        from ..services import suite

        suite.refuse_unless_keeper(db, operator, "backups_emergency_only",
                                   "While connected to nexsuite, only the emergency account handles backups.")
        confirm_operator(request, db, operator, body.password)
    try:
        backups.remove(name)
    except backups.BackupError as exc:
        raise _fail(exc) from exc

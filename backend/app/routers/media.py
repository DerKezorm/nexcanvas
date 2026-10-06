"""Uploading photos and files for a board, and handing them out to those who may read the space."""

from __future__ import annotations

import os
from dataclasses import asdict
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Query, Request, Response
from fastapi import Path as PathParam
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from starlette.requests import ClientDisconnect

from ..db import SessionLocal
from ..deps import Account
from ..errors import error
from ..models import READ, WRITE, Media
from ..services import media_store, rights

router = APIRouter(prefix="/api", tags=["media"])

#: Whatever a file holds, it never runs as a page of nexcanvas.
FILE_POLICY = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
MediaId = Annotated[str, PathParam(min_length=8, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]


@router.post("/media", status_code=201, summary="Upload a photo or file into a space (the body is the file)")
async def upload(
    request: Request,
    account: Account,
    space: Annotated[int, Query(ge=1)],
    name: Annotated[str, Query(min_length=1, max_length=255)],
) -> dict[str, Any]:
    with SessionLocal() as db:
        try:
            rights.check(db, account, space, WRITE)
        except rights.RightsError as exc:
            raise error(exc.code, exc.text, exc.status) from exc
        limit = media_store.max_bytes(db)
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise error("too_large", "The file is larger than allowed.", 413, max_mb=limit // (1024 * 1024))
    received = media_store.temporary()
    size = 0
    try:
        async with await anyio.open_file(received, "wb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise error("too_large", "The file is larger than allowed.", 413, max_mb=limit // (1024 * 1024))
                await handle.write(chunk)
            await handle.flush()
            await anyio.to_thread.run_sync(os.fsync, handle.wrapped.fileno())
        if not size:
            raise error("empty", "The file is empty.")

        def finish() -> media_store.Stored:
            with SessionLocal() as db:
                return media_store.finish(db, account, space, received, name)

        stored = await run_in_threadpool(finish)
    except ClientDisconnect as exc:
        raise error("upload_aborted", "The upload stopped before the end.") from exc
    except media_store.MediaError as exc:
        raise error(exc.code, exc.text, exc.status, **exc.values()) from exc
    finally:
        received.unlink(missing_ok=True)
    return asdict(stored)


@router.get("/media/{media_id}", response_model=None, summary="A photo or file, for those who may read its space")
def file(
    media_id: MediaId, request: Request, account: Account, download: bool = False, preview: bool = False
) -> Response:
    with SessionLocal() as db:
        row = db.get(Media, media_id)
        if row is None or not rights.at_least(rights.role_in(db, account, row.space_id), READ):
            raise error("not_found", "Not found.", 404)
        db.expunge(row)
    return deliver(row, request, download, preview)


def deliver(row: Media, request: Request, download: bool, preview: bool = False) -> Response:
    """The bytes, shown in the page only when a browser shows that kind by itself; everything else a download.
    ``preview``: the smaller copy of a large photo, when there is one (the original otherwise)."""
    small = media_store.preview_of(row.id) if preview and not download else None
    if small is not None and small.is_file():
        return FileResponse(small, media_type="image/webp", headers={
            "Cache-Control": "private, max-age=31536000, immutable", "Content-Security-Policy": FILE_POLICY,
            "X-Content-Type-Options": "nosniff"})
    path = media_store.path_of(row.id)
    if not path.is_file():
        raise error("not_found", "Not found.", 404)
    # The id never changes its bytes: kept by the browser for a year, asked again never.
    headers = {"Cache-Control": "private, max-age=31536000, immutable", "Content-Security-Policy": FILE_POLICY,
               "X-Content-Type-Options": "nosniff"}
    shown = not download and row.kind in media_store.SHOWN
    return FileResponse(
        path, media_type=row.mime, headers=headers, filename=row.name,
        content_disposition_type="inline" if shown else "attachment",
    )

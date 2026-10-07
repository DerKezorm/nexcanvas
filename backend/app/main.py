"""Entry point: the FastAPI app, routers, background tasks, the built frontend."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__, private
from .config import get_settings
from .db import SessionLocal, init_db
from .errors import detail
from .middleware import GuardMiddleware, RequestContextMiddleware, unhandled_error
from .routers import about, apitokens, auth, boards, health, media, members, oidc, shapes, shares, spaces, templates
from .routers import avatars as avatars_router
from .routers import backups as backups_router
from .routers import directory as directory_router
from .routers import locales as locales_router
from .routers import logs as logs_router
from .routers import settings as settings_router
from .routers import suite as suite_router
from .routers import totp as totp_router
from .routers import v1 as v1_router
from .security import HashingBusy, purge_sessions
from .services import accounts, backups, cleanup, locales, logs, settings_service, totp
from .services import boards as boards_service

logger = logging.getLogger("nexcanvas")

ROUTERS = [
    health, about, locales_router, logs_router, auth, totp_router, oidc, members, settings_router, backups_router,
    avatars_router, spaces, directory_router, suite_router, boards, media, shares, shapes, templates, apitokens,
    v1_router,
]


def _read_log_mode() -> tuple[str, datetime | None]:
    with SessionLocal() as db:
        mode = settings_service.get(db, "log_mode")
        raw = settings_service.get(db, "log_mode_until")
    until = datetime.fromisoformat(raw).astimezone(UTC) if raw else None
    return str(mode or logs.DEFAULT_MODE), until


def _write_log_mode(mode: str, until: datetime | None) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"log_mode": mode, "log_mode_until": until.isoformat() if until else None})


async def _suite_forever(stop: asyncio.Event) -> None:
    """Connected to nexsuite: fetch the directory once a minute, whatever the notices did."""
    from .services import suite

    while not stop.is_set():
        try:
            await asyncio.to_thread(suite.run_forever_sync)
        except Exception:
            logger.exception("Fetching the directory from nexsuite failed")
        try:
            await asyncio.wait_for(stop.wait(), 60)
        except TimeoutError:
            continue


async def _sweep_forever(stop: asyncio.Event) -> None:
    """Enrolments and sign-ins waiting for their second factor run out; what ran out goes from memory, ended
    sessions from the database once an hour (they stayed until someone showed them again)."""
    rounds = 0
    while not stop.is_set():
        totp.sweep()
        if rounds % 60 == 0:
            with SessionLocal() as db:
                purge_sessions(db)
        rounds += 1
        try:
            await asyncio.wait_for(stop.wait(), 60)
        except TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    logs.setup()
    backups.apply_pending()
    init_db()
    private.tighten_all()
    logs.attach_store(_read_log_mode, _write_log_mode)
    logs.apply_stored_mode()
    settings = get_settings()
    for directory in (settings.media_dir, settings.locales_dir):
        if directory is not None:
            directory.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        folded = boards_service.fold_leftovers(db)
    if folded:
        logger.info("Boards folded after the last stop count=%s", folded)
    added = locales.available()
    if added:
        logger.info("Languages added by the operator: %s", ", ".join(locale.code for locale in added))
    stop = asyncio.Event()
    tasks: list[asyncio.Task[None]] = []
    settings.resolved_secret_key()
    if not settings.disable_background:
        tasks.append(asyncio.create_task(logs.run_forever(stop)))
        tasks.append(asyncio.create_task(backups.run_forever(stop)))
        tasks.append(asyncio.create_task(cleanup.run_forever(stop)))
        tasks.append(asyncio.create_task(_sweep_forever(stop)))
        tasks.append(asyncio.create_task(_suite_forever(stop)))
    logger.info("nexcanvas %s started", __version__)
    with SessionLocal() as db:
        accounts.announce_setup_code(db)
    try:
        yield
    finally:
        stop.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("nexcanvas stopped")


app = FastAPI(
    title="nexcanvas",
    version=__version__,
    lifespan=lifespan,
    docs_url="/api/docs" if get_settings().api_docs else None,
    openapi_url="/api/openapi.json" if get_settings().api_docs else None,
    redoc_url=None,
)
# Added last, runs first: the request id and headers wrap everything, the guard sits inside it.
app.add_middleware(GuardMiddleware)
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [".".join(str(part) for part in error.get("loc", ()) if part != "body") for error in exc.errors()]
    return JSONResponse(
        status_code=422, content={"detail": detail("invalid_input", "The input is not valid.", fields=fields)}
    )


@app.exception_handler(OverflowError)
async def _too_large_a_number(_request: Request, _exc: OverflowError) -> JSONResponse:
    # A number past what SQLite holds (an id like 99999999999999999999 in the address): not a fault of the server.
    return JSONResponse(status_code=422, content={"detail": detail("invalid_input", "The input is not valid.")})


@app.exception_handler(HashingBusy)
async def _hashing_busy(_request: Request, _exc: HashingBusy) -> JSONResponse:
    # Every slot for checking a password stayed taken for 15 s: many sign-ins at once, as in a flood of guesses.
    return JSONResponse(status_code=503, headers={"Retry-After": "5"},
                        content={"detail": detail("busy", "The server is busy. Try again in a moment.")})


@app.exception_handler(UnicodeEncodeError)
async def _not_unicode(_request: Request, _exc: UnicodeEncodeError) -> JSONResponse:
    # JSON may carry a lone surrogate ("\ud800"); no file name, path or database text can hold it.
    return JSONResponse(status_code=422, content={"detail": detail("invalid_input", "The input is not valid.")})


@app.exception_handler(StarletteHTTPException)
async def _plain_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    # FastAPI's own 400 for a body that is not JSON carries only a text; give it a code like every other answer.
    if exc.status_code == 400 and isinstance(exc.detail, str):
        return JSONResponse(status_code=400, content={"detail": detail("invalid_input", "The input is not valid.")})
    # A file under /assets/ that is not there (an old page after an update), or a path no route knows: the same
    # answer as every other "not found", not Starlette's bare text (Prüfgang H18, as nextasks).
    if exc.status_code == 404 and isinstance(exc.detail, str):
        return JSONResponse(status_code=404, content={"detail": detail("not_found", "Not found.")})
    return await http_exception_handler(request, exc)


app.add_exception_handler(Exception, unhandled_error)

for module in ROUTERS:
    app.include_router(module.router)


def _mount_frontend(target: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not index.exists():
        return
    if (dist / "assets").is_dir():
        target.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    root = dist.resolve()
    start_page = index.resolve()

    @target.get("/{path:path}", include_in_schema=False, response_model=None)
    def spa(path: str) -> FileResponse | JSONResponse:
        if path == "api" or path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": detail("not_found", "Not found.")})
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and root in candidate.parents and candidate != start_page:
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


_mount_frontend(app, get_settings().frontend_dist)

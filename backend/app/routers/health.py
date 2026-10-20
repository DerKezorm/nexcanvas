from __future__ import annotations

import time

from fastapi import APIRouter

from .. import __version__

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", summary="Is nexcanvas running?")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/clock", summary="The server's time in milliseconds, so timers on a board run alike for everybody")
def clock() -> dict[str, int]:
    return {"now": int(time.time() * 1000)}

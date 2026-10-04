"""nexcanvas and nexsuite (``services/suite.py``): the connection as the operator sees and changes it, and the
notices nexsuite sends."""

from __future__ import annotations

import logging
import threading
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel, Field

from ..deps import Account, DbSession, OperatorAccount, confirm_operator
from ..errors import error
from ..services import suite
from .oidc import _redirect_uri

logger = logging.getLogger("nexcanvas.suite")

router = APIRouter(prefix="/api/suite", tags=["nexsuite"])


class StartIn(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    code: str = Field(min_length=4, max_length=40)


class FinishIn(BaseModel):
    #: Per account here: a person id in nexsuite, ``new`` or ``skip``.
    accounts: dict[int, str] = Field(default_factory=dict)
    #: Per space here: a space id in nexsuite or ``new``.
    spaces: dict[int, str] = Field(default_factory=dict)
    #: Per team here: a team id in nexsuite or ``new``.
    teams: dict[int, str] = Field(default_factory=dict)


class ConfirmIn(BaseModel):
    current_password: str = Field(default="", max_length=200)


class EmergencyIn(ConfirmIn):
    code: str = Field(min_length=4, max_length=40)


def _fail(exc: suite.SuiteError) -> Exception:
    return error(exc.code, exc.text, exc.status)


@router.get("", summary="Whether nexcanvas hangs on nexsuite; details for the operator")
def status(account: Account, db: DbSession) -> dict[str, Any]:
    view = suite.view(db)
    if account.role != "operator":
        return {"state": view["state"], "url": view["url"]}
    return view


@router.post("/start", summary="Pair with nexsuite using a one-time code; returns what to match (operator)")
def start(payload: StartIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    redirect = _redirect_uri(db, request)
    own = redirect.removesuffix("/api/oidc/callback")
    try:
        found = suite.start(db, payload.url, payload.code, redirect, own)
    except suite.SuiteError as exc:
        raise _fail(exc) from exc
    logger.info("Pairing with nexsuite started by=%s", operator.name)
    return asdict(found)


@router.get("/proposal", summary="What to match, while connecting (operator)")
def proposal(_operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    try:
        return asdict(suite.proposal(db))
    except suite.SuiteError as exc:
        raise _fail(exc) from exc


@router.post("/finish", summary="Apply the matches and connect (operator)")
def finish(payload: FinishIn, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    try:
        new_people = suite.finish(db, operator, payload.accounts, payload.spaces, payload.teams)
    except suite.SuiteError as exc:
        db.rollback()
        raise _fail(exc) from exc
    # Who was made new in nexsuite, and whether the link to set the password went by mail (B3).
    return {**suite.view(db), "new_people": new_people}


@router.post("/abort", status_code=204, summary="Give up a connection that did not finish (operator)")
def abort(_operator: OperatorAccount, db: DbSession) -> None:
    suite.abort(db)


@router.post("/sync", summary="Fetch the directory now (operator)")
def sync(_operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    if not suite.connected(db):
        raise error("not_connected", "nexcanvas is not connected to nexsuite.", 409)
    suite.sync(db)
    return suite.view(db)


@router.post("/disconnect", summary="Run on its own again; nexsuite forgets the app (operator)")
def disconnect(payload: ConfirmIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    suite.refuse_unless_keeper(db, operator)
    confirm_operator(request, db, operator, payload.current_password)
    if not suite.connected(db):
        raise error("not_connected", "nexcanvas is not connected to nexsuite.", 409)
    try:
        without, blocked = suite.disconnect(db)
    except suite.SuiteError as exc:
        raise _fail(exc) from exc
    logger.warning("Disconnected from nexsuite by=%s", operator.name)
    return {"without_password": without, "blocked": blocked}


@router.post("/emergency", summary="Disconnect with an emergency code, nexsuite out of reach (operator)")
def emergency(payload: EmergencyIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    suite.refuse_unless_keeper(db, operator)
    confirm_operator(request, db, operator, payload.current_password)
    if not suite.connected(db):
        raise error("not_connected", "nexcanvas is not connected to nexsuite.", 409)
    if not suite.emergency_ok(db, payload.code):
        raise error("emergency_code_wrong", "This emergency code is not valid.", 403)
    suite.report(db, "emergency_disconnect", operator.name)
    without, blocked = suite.disconnect(db, tell=False)
    logger.warning("Disconnected from nexsuite with an emergency code by=%s", operator.name)
    return {"without_password": without, "blocked": blocked}


def _sync_later() -> None:
    threading.Thread(target=suite.run_forever_sync, name="suite-notice", daemon=True).start()


@router.post("/event", status_code=204, summary="A notice from nexsuite (signed with the app's token)")
async def event(
    request: Request,
    db: DbSession,
    x_nexsuite_time: Annotated[str, Header()] = "",
    x_nexsuite_signature: Annotated[str, Header()] = "",
) -> Response:
    body = await request.body()
    data = suite.check_notice(db, x_nexsuite_time, x_nexsuite_signature, body)
    if data is None:
        raise error("notice_refused", "Not a notice from nexsuite.", 401)
    if data.get("kind") == "disconnected":
        suite.disconnect(db, tell=False)
    elif suite.INLINE:
        suite.run_forever_sync()
    else:
        _sync_later()
    return Response(status_code=204)

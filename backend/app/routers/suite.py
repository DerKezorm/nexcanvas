"""nexcanvas and nexsuite (``services/suite.py``): the connection as the operator sees and changes it, and the
notices nexsuite sends."""

from __future__ import annotations

import logging
import threading
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..deps import Account, DbSession, OperatorAccount, confirm_operator
from ..errors import error
from ..services import suite
from ..vendor.nexoidc import LEGACY_SLUG, flow

logger = logging.getLogger("nexcanvas.suite")

router = APIRouter(prefix="/api/suite", tags=["nexsuite"])


class StartIn(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    #: Checked in ``suite.start`` (4 to 40 characters once trimmed), so a wrong length reads as a wrong code (B24).
    code: str = Field(min_length=1, max_length=500)


class FinishIn(BaseModel):
    #: Per account here: a person id in nexsuite, ``new`` or ``skip``.
    accounts: dict[int, str] = Field(default_factory=dict)
    #: Per space here: a space id in nexsuite, ``new`` or ``keep`` (stays here only).
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
    # Who stops being an operator when disconnecting, for the dialog (B17), by the names people see. A connection from
    # before the roles were kept changes no role: the dialog says so and names the operators who stay.
    return {**view, "operators_from_suite": [suite.shown(row) for row in suite.operators_from_suite(db)],
            "roles_kept": suite.roles_kept(db),
            "operators_staying": [suite.shown(row) for row in suite.operators_staying(db)]}


@router.post("/start", summary="Pair with nexsuite using a one-time code; returns what to match (operator)")
def start(payload: StartIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    # The return address of the coupled entry ``oidc`` (blueprint 06): nexsuite compares it exactly and keeps it.
    redirect = flow.redirect_uri(LEGACY_SLUG, str(request.base_url))
    own = flow.base_address(str(request.base_url))
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


class ChoicesIn(FinishIn):
    #: The step of the assistant the operator stood at (2: accounts, 3: spaces and teams).
    step: int = Field(default=2, ge=2, le=3)


@router.put("/choices", status_code=204, summary="Keep the choices so far, while connecting (operator)")
def keep_choices(payload: ChoicesIn, _operator: OperatorAccount, db: DbSession) -> None:
    # Bounded like everything else kept: not more entries than an instance has accounts, spaces and teams.
    if len(payload.accounts) + len(payload.spaces) + len(payload.teams) > 5000:
        raise error("too_many", "Too many choices.", 422)
    try:
        suite.keep_choices(db, {"accounts": {str(k): v[:40] for k, v in payload.accounts.items()},
                                "spaces": {str(k): v[:40] for k, v in payload.spaces.items()},
                                "teams": {str(k): v[:40] for k, v in payload.teams.items()},
                                "step": payload.step})
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


@router.post("/abort", status_code=204, response_model=None,
             summary="Give up a connection that did not finish (operator)")
def abort(_operator: OperatorAccount, db: DbSession) -> Response:
    try:
        kept = suite.abort(db)
    except suite.SuiteError as exc:
        raise _fail(exc) from exc
    if kept:
        # /finish had gone out and nexsuite could not be told: the page says the app may stand there still.
        return JSONResponse({"kept_in_suite": True})
    return Response(status_code=204)


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
        without, blocked, back = suite.disconnect(db)
    except suite.SuiteError as exc:
        raise _fail(exc) from exc
    logger.warning("Disconnected from nexsuite by=%s", operator.name)
    return {"without_password": without, "blocked": blocked, "operators_back": back}


@router.post("/emergency", summary="Disconnect with an emergency code, nexsuite out of reach (operator)")
def emergency(payload: EmergencyIn, request: Request, operator: OperatorAccount, db: DbSession) -> dict[str, Any]:
    suite.refuse_unless_keeper(db, operator)
    confirm_operator(request, db, operator, payload.current_password)
    if not suite.connected(db):
        raise error("not_connected", "nexcanvas is not connected to nexsuite.", 409)
    if not suite.emergency_ok(db, payload.code):
        raise error("emergency_code_wrong", "This emergency code is not valid.", 403)
    suite.report(db, "emergency_disconnect", operator.name)
    without, blocked, back = suite.disconnect(db, tell=False)
    logger.warning("Disconnected from nexsuite with an emergency code by=%s", operator.name)
    return {"without_password": without, "blocked": blocked, "operators_back": back}


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

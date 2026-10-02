"""Every test run gets its own empty data directory; nothing touches ``data/`` of the project."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator

_DATA = tempfile.mkdtemp(prefix="nexcanvas-tests-")
os.environ["NEXCANVAS_DATA_DIR"] = _DATA
os.environ["NEXCANVAS_DISABLE_BACKGROUND"] = "1"
os.environ["NEXCANVAS_FRONTEND_DIST"] = os.path.join(_DATA, "no-frontend")
# Set, not removed: a value in the environment wins over a .env file in the project, a removed one does not.
os.environ["NEXCANVAS_MEDIA_DIR"] = os.path.join(_DATA, "media")
os.environ["NEXCANVAS_LOCALES_DIR"] = os.path.join(_DATA, "locales")
os.environ["NEXCANVAS_LOG_LEVEL"] = ""
os.environ["NEXCANVAS_API_DOCS"] = "false"
# Argon2 as cheap as it goes: the tests make many accounts. The strength itself is Argon2's business.
os.environ["NEXCANVAS_ARGON2_TIME"] = "1"
os.environ["NEXCANVAS_ARGON2_MEMORY_KIB"] = "1024"
os.environ["NEXCANVAS_ARGON2_PARALLELISM"] = "1"
# Never GitHub from a test: port 9 refuses at once.
os.environ["NEXCANVAS_UPDATE_URL"] = "http://127.0.0.1:9/releases/latest"
os.environ["NEXCANVAS_SECRET_KEY"] = "test-secret-key-for-the-test-run-only"
SETUP_CODE = "test-setup-code"
os.environ["NEXCANVAS_SETUP_TOKEN"] = SETUP_CODE

import shutil  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import MEMBER, OPERATOR, Account, Base, Setting  # noqa: E402
from app.security import SESSION_COOKIE, brake, hash_password, start_session  # noqa: E402
from app.services import live, totp, updates  # noqa: E402

DATA_DIR = _DATA
MEDIA = Path(_DATA) / "media"
TAB = {"X-Nexcanvas-Client": "tab-tests000"}


@pytest.fixture(scope="session", autouse=True)
def schema() -> None:
    init_db()


@pytest.fixture(autouse=True)
def clean_db(schema: None) -> Iterator[None]:
    with SessionLocal() as db:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(delete(table))
        db.execute(delete(Setting))
        db.commit()
    assert MEDIA.resolve().is_relative_to(Path(_DATA).resolve())
    shutil.rmtree(MEDIA, ignore_errors=True)
    MEDIA.mkdir(parents=True)
    brake.forget()
    totp.forget()
    updates.forget()
    live.forget()
    yield
    app.dependency_overrides.clear()


PASSWORD = "correct horse battery"


def make_account(name: str, role: str = MEMBER, password: str = PASSWORD) -> Account:
    """An account with a password, straight into the database."""
    with SessionLocal() as db:
        row = Account(name=name, role=role, password_hash=hash_password(password))
        db.add(row)
        db.commit()
        db.expunge(row)
    return row


def sign_in(client: TestClient, account: Account) -> None:
    """The client carries a session of ``account`` from now on (a real one, as after signing in)."""
    with SessionLocal() as db:
        row = db.get(Account, account.id)
        assert row is not None
        token = start_session(db, row, "127.0.0.1", "tests")
    client.cookies.set(SESSION_COOKIE, token)


def new_client(account: Account | None = None) -> TestClient:
    """Another browser, signed in as ``account`` when one is given. Close it (``with``) when done."""
    client = TestClient(app, base_url="http://testserver", headers=TAB)
    if account is not None:
        sign_in(client, account)
    return client


def join(manager: TestClient, space_id: int, name: str, role: str) -> None:
    """``name`` gets ``role`` in the space: a member's right changes at once; anybody else is invited by the manager
    and says yes, as in the interface."""
    from app.models import SpaceNotice
    from app.services import notices

    answer = manager.put(f"/api/spaces/{space_id}/members/{name}", json={"role": role})
    assert answer.status_code in (200, 202), answer.text
    if answer.status_code == 202:
        with SessionLocal() as db:
            person = db.query(Account).filter_by(name=name).one()
            notice = db.query(SpaceNotice).filter_by(account_id=person.id, kind="invite", done_at=None).order_by(
                SpaceNotice.id.desc()).first()
            assert notice is not None
            notices.answer(db, person, notice.id, accept=True)


def _operator(client: TestClient) -> Account:
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name="tester").one_or_none()
        if row is not None:
            db.expunge(row)
    if row is None:
        row = make_account("tester", OPERATOR)
    sign_in(client, row)
    return row


@pytest.fixture
def client() -> Iterator[TestClient]:
    # As the interface does: every request names its tab (changes are refused without it).
    with TestClient(app, base_url="http://testserver", headers=TAB) as test_client:
        yield test_client


@pytest.fixture
def operator(client: TestClient) -> Account:
    """The signed-in operator ``tester``."""
    return _operator(client)


@pytest.fixture
def account(client: TestClient) -> Account:
    """The same as ``operator``, under the name the tests from nexlore use."""
    return _operator(client)


@pytest.fixture
def space(client: TestClient, operator: Account) -> int:
    """A space the operator made and manages."""
    answer = client.post("/api/spaces", json={"name": "Home"})
    assert answer.status_code == 201, answer.text
    return int(answer.json()["id"])

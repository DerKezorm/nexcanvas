"""Prüfgang 05.10.2026 for nexcanvas, block 4, as nextasks d14d184 and nexbrand b3df2c9: the invitation page names who
invites and says when a link expired (E18, G4), the operator's invitation can bring a person straight into a space
(E18, decided 2026-10-06 for nexcanvas), nothing of nexcanvas belongs in a search engine (F13), and the log hands
each line's moment with its offset (G11)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Account, Invite, Membership, utcnow
from app.services import logs

GOOD = "a long enough password"


def _token(link: str) -> str:
    return link.rsplit("/", 1)[1]


def _stranger(client: TestClient) -> TestClient:
    return TestClient(client.app, headers={"X-Nexcanvas-Client": "tab-stranger0"})


def _rename(name: str, display_name: str) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(Account).where(Account.name == name))
        assert row is not None
        row.display_name = display_name
        db.commit()


def test_the_invitation_page_names_who_invites_as_others_see_them(client: TestClient, operator: Account) -> None:
    token = _token(client.post("/api/invites", json={}).json()["link"])
    assert _stranger(client).get(f"/api/invite/{token}").json()["by"] == "tester"
    _rename("tester", "Robin Keller")
    assert _stranger(client).get(f"/api/invite/{token}").json()["by"] == "Robin Keller"


def test_an_expired_link_says_so_and_any_other_that_it_is_not_valid(client: TestClient, operator: Account) -> None:
    expired = _token(client.post("/api/invites", json={}).json()["link"])
    withdrawn = client.post("/api/invites", json={}).json()
    with SessionLocal() as db:
        for row in db.scalars(select(Invite)):
            if row.id != withdrawn["id"]:
                row.expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    assert client.delete(f"/api/invites/{withdrawn['id']}").status_code == 204
    stranger = _stranger(client)
    for answer in (stranger.get(f"/api/invite/{expired}"),
                   stranger.post(f"/api/invite/{expired}", json={"name": "dora", "password": GOOD})):
        assert answer.status_code == 404
        assert answer.json()["detail"]["code"] == "invite_expired"
    gone = stranger.get(f"/api/invite/{_token(withdrawn['link'])}")
    assert gone.status_code == 404 and gone.json()["detail"]["code"] == "invite_invalid"
    assert stranger.get("/api/invite/" + "x" * 32).json()["detail"]["code"] == "invite_invalid"


def test_the_operator_invites_straight_into_a_space_with_a_right(client: TestClient, operator: Account,
                                                                 space: int) -> None:
    made = client.post("/api/invites", json={"space": space, "role": "write"})
    assert made.status_code == 201, made.text
    listed = client.get("/api/invites").json()
    assert [(row["space"], row["role"]) for row in listed] == [("Home", "write")]
    stranger = _stranger(client)
    seen = stranger.get(f"/api/invite/{_token(made.json()['link'])}").json()
    assert (seen["space"], seen["role"], seen["by"]) == ("Home", "write", "tester")
    joined = stranger.post(f"/api/invite/{_token(made.json()['link'])}", json={"name": "dora", "password": GOOD})
    assert joined.status_code == 200, joined.text
    with SessionLocal() as db:
        dora = db.scalar(select(Account).where(Account.name == "dora"))
        assert dora is not None
        assert db.get(Membership, (space, dora.id)).role == "write"


def test_without_a_space_it_stays_an_invitation_into_nexcanvas(client: TestClient, operator: Account,
                                                               space: int) -> None:
    made = client.post("/api/invites", json={})
    assert made.status_code == 201
    assert [row["space"] for row in client.get("/api/invites").json()] == [None]
    refused = client.post("/api/invites", json={"role": "write"})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "invalid_role"


def test_a_space_needs_a_right_it_knows_and_must_be_there(client: TestClient, operator: Account, space: int) -> None:
    for role in ("", "owner"):
        refused = client.post("/api/invites", json={"space": space, "role": role})
        assert refused.status_code == 422 and refused.json()["detail"]["code"] == "invalid_role"
    missing = client.post("/api/invites", json={"space": 9999, "role": "read"})
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "not_found"
    # One into a space in the trash is no way in any more and leaves the list.
    client.post("/api/invites", json={"space": space, "role": "read"})
    assert client.delete(f"/api/spaces/{space}").status_code in (200, 204)
    assert client.get("/api/invites").json() == []


def test_only_the_operator_invites_this_way(client: TestClient, operator: Account, space: int) -> None:
    from .conftest import make_account, new_client

    member = make_account("member")
    with new_client(member) as other:
        refused = other.post("/api/invites", json={"space": space, "role": "manage"})
        assert refused.status_code == 403


def test_nothing_of_nexcanvas_is_for_search_engines(client: TestClient, operator: Account) -> None:
    for path in ("/api/about", "/api/public/no-such-page", "/api/no/such/route"):
        assert client.get(path).headers.get("x-robots-tag") == "noindex, nofollow", path
    # The page itself says it too, for a proxy that drops headers.
    from pathlib import Path

    index = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")
    assert '<meta name="robots" content="noindex, nofollow" />' in index


def test_a_log_line_carries_its_moment_with_the_offset(client: TestClient, operator: Account) -> None:
    logging.getLogger("nexcanvas.probe").warning("probe-moment line")
    line = client.get("/api/logs", params={"search": "probe-moment"}).json()[0]
    moment = datetime.fromisoformat(line["at"])
    assert moment.utcoffset() is not None
    assert moment.strftime(logs.DATE_FORMAT) == line["time"]
    assert logs.moment_of("not a time") is None

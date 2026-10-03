"""Teams: who makes and changes them, the rights a team brings in a space, and who sees whom through a team."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Account
from app.services import avatars

from .conftest import join, make_account, new_client


def _team(client: TestClient, name: str = "Design", members: list[int] | None = None, **extra: object) -> dict:
    answer = client.post("/api/teams", json={"name": name, "members": members or [], **extra})
    assert answer.status_code == 201, answer.text
    return answer.json()


def _board(client: TestClient, space: int) -> str:
    answer = client.post("/api/boards", json={"space_id": space, "title": "Plan"})
    assert answer.status_code == 201, answer.text
    return str(answer.json()["id"])


def test_the_operator_makes_a_team_and_its_members_see_each_other(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    make_account("ben")
    team = _team(client, members=[anna.id, operator.id], lead=anna.id)
    assert team["members"] == sorted([anna.id, operator.id]) and team["lead"] == anna.id and team["source"] == "local"
    with new_client(anna) as browser:
        seen = browser.get("/api/directory").json()
        assert [t["name"] for t in seen["teams"]] == ["Design"]
        assert {p["name"] for p in seen["people"]} == {"anna", "tester"}, "ben shares nothing with anna"
        assert browser.post("/api/teams", json={"name": "Mine"}).status_code == 403
    assert {p["name"] for p in client.get("/api/directory").json()["people"]} == {"anna", "ben", "tester"}


def test_a_team_shows_only_the_members_one_may_see_but_counts_them_all(client: TestClient, operator: Account) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    _team(client, members=[ben.id, operator.id], lead=ben.id)
    with new_client(anna) as browser:
        team = browser.get("/api/directory").json()["teams"][0]
        assert team["members"] == [] and team["size"] == 2 and team["lead"] is None


def test_the_lead_changes_members_only_and_only_with_people_they_see(client: TestClient, operator: Account,
                                                                     space: int) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    team = _team(client, members=[anna.id], lead=anna.id)
    with new_client(anna) as browser:
        answer = browser.patch(f"/api/teams/{team['id']}", json={"members": [anna.id, ben.id]})
        assert answer.status_code == 422 and answer.json()["detail"]["code"] == "unknown_account"
        join(client, space, "anna", "read")
        join(client, space, "ben", "read")
        answer = browser.patch(f"/api/teams/{team['id']}", json={"members": [anna.id, ben.id]})
        assert answer.status_code == 200 and answer.json()["members"] == sorted([anna.id, ben.id])
        assert browser.patch(f"/api/teams/{team['id']}", json={"name": "Renamed"}).status_code == 403
    with new_client(ben) as browser:
        assert browser.patch(f"/api/teams/{team['id']}", json={"members": [ben.id]}).status_code == 403


def test_a_lead_must_be_in_the_team(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    team = _team(client)
    answer = client.patch(f"/api/teams/{team['id']}", json={"lead": anna.id})
    assert answer.status_code == 422 and answer.json()["detail"]["code"] == "lead_not_member"


def test_a_team_right_opens_the_space_and_its_boards_and_taking_it_closes_them(client: TestClient,
                                                                               operator: Account, space: int) -> None:
    anna = make_account("anna")
    team = _team(client, members=[anna.id])
    board = _board(client, space)
    with new_client(anna) as browser:
        assert browser.get("/api/spaces").json() == []
        assert browser.get(f"/api/boards/{board}").status_code == 404
        assert client.put(f"/api/spaces/{space}/teams/{team['id']}", json={"role": "read"}).status_code == 200
        seen = browser.get("/api/spaces").json()
        assert [s["id"] for s in seen] == [space] and seen[0]["role"] == "read"
        assert seen[0]["teams"] == [{"id": team["id"], "name": "Design", "color": "#ff8a70", "role": "read"}]
        assert browser.get(f"/api/boards/{board}").status_code == 200
        assert browser.patch(f"/api/boards/{board}", json={"title": "Mine"}).status_code == 403
        assert client.delete(f"/api/spaces/{space}/teams/{team['id']}").status_code == 200
        assert browser.get("/api/spaces").json() == []
        assert browser.get(f"/api/boards/{board}").status_code == 404


def test_the_higher_of_own_and_team_right_counts(client: TestClient, operator: Account, space: int) -> None:
    anna = make_account("anna")
    join(client, space, "anna", "read")
    team = _team(client, members=[anna.id])
    client.put(f"/api/spaces/{space}/teams/{team['id']}", json={"role": "manage"})
    with new_client(anna) as browser:
        assert browser.get("/api/spaces").json()[0]["role"] == "manage"


def test_an_operator_does_not_see_a_space_only_a_team_has(client: TestClient, operator: Account) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    team = _team(client, members=[anna.id, ben.id])
    with new_client(anna) as browser:
        other = browser.post("/api/spaces", json={"name": "Workshop"}).json()["id"]
        browser.put(f"/api/spaces/{other}/teams/{team['id']}", json={"role": "write"})
        # Nobody would manage the space any more: the team only writes.
        left = browser.delete(f"/api/spaces/{other}/members/anna")
        assert left.status_code == 409 and left.json()["detail"]["code"] == "last_manager"
        browser.put(f"/api/spaces/{other}/teams/{team['id']}", json={"role": "manage"})
        assert browser.delete(f"/api/spaces/{other}/members/anna").status_code == 204
        assert browser.get("/api/spaces").json()[0]["role"] == "manage"
    assert other not in [s["id"] for s in client.get("/api/spaces").json()]
    # Asked directly, too: the operator has no right there, the same 404 as for a space that does not exist.
    assert client.patch(f"/api/spaces/{other}", json={"name": "Mine"}).status_code == 404


def test_a_manager_through_a_team_invites_and_the_invitation_holds(client: TestClient, operator: Account,
                                                                    space: int) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    team = _team(client, members=[anna.id])
    client.put(f"/api/spaces/{space}/teams/{team['id']}", json={"role": "manage"})
    with new_client(anna) as browser:
        join(browser, space, "ben", "write")
    with new_client(ben) as browser:
        assert browser.get("/api/spaces").json()[0]["role"] == "write"


def test_deleting_a_team_takes_its_rights_along(client: TestClient, operator: Account, space: int) -> None:
    anna = make_account("anna")
    team = _team(client, members=[anna.id])
    client.put(f"/api/spaces/{space}/teams/{team['id']}", json={"role": "write"})
    assert client.delete(f"/api/teams/{team['id']}").status_code == 204
    with new_client(anna) as browser:
        assert browser.get("/api/spaces").json() == []
    assert client.get("/api/spaces").json()[0]["teams"] == []


def test_a_shared_team_or_a_space_through_a_team_lets_people_see_each_other(client: TestClient,
                                                                            operator: Account, space: int) -> None:
    anna, ben, cleo = make_account("anna"), make_account("ben"), make_account("cleo")
    with SessionLocal() as db:
        assert not avatars.may_see(db, db.get(Account, anna.id), ben.id)
    _team(client, name="Pair", members=[anna.id, ben.id])
    team = _team(client, name="Shop", members=[cleo.id])
    join(client, space, "anna", "read")
    client.put(f"/api/spaces/{space}/teams/{team['id']}", json={"role": "read"})
    with SessionLocal() as db:
        row = db.get(Account, anna.id)
        assert avatars.may_see(db, row, ben.id), "a shared team"
        assert avatars.may_see(db, row, cleo.id), "a space cleo has through her team"
        assert not avatars.may_see(db, row, 999_999)
        assert avatars.may_see(db, db.get(Account, cleo.id), anna.id)
        assert not avatars.may_see(db, db.get(Account, cleo.id), ben.id)

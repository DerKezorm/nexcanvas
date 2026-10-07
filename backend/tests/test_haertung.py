"""Prüfgang 05.10.2026 for nexcanvas on its own, as in nextasks and nexbrand: API tokens and a lock from guessing, the
sign-in brake behind a proxy and device cookies (A5), pictures counted before they open (A7), control characters in
mail addresses and names (A13), an unchanged password (E25), mail without a mail server (G12), team leads (D3), a
blocked account at the sign-in (A16)."""

from __future__ import annotations

import io
import logging
import secrets
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import Account, Invite, Media, utcnow
from app.security import DEVICE_COOKIE, MAX_FAILURES, brake, device_token, hash_password
from app.services import apitokens, media, media_store, settings_service

from . import test_suite
from .conftest import PASSWORD, make_account, new_client
from .test_suite import FakeSuite, connect

fake = test_suite.fake
world = test_suite.world

NEW_PASSWORD = "another long password"


def _browser(host: str = "172.18.0.2") -> TestClient:
    """A browser behind the proxy nobody named: every one of them comes from the proxy's address."""
    return TestClient(app, base_url="http://testserver", headers={"X-Nexcanvas-Client": "tab-proxy00001"},
                      client=(host, 50000))


def _code(answer: object) -> str:
    return str(answer.json()["detail"]["code"])  # type: ignore[attr-defined]


def _row(name: str) -> Account:
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name=name).one()
        db.expunge(row)
    return row


# --- #job-172b: a lock from wrong passwords leaves the tokens working ----------------------------------------------


def test_a_lock_from_wrong_passwords_leaves_the_tokens_working(client: TestClient, operator: Account,
                                                              space: int) -> None:
    """Ten guesses by a stranger would otherwise switch off every program the account feeds (decided 2026-10-05).
    A block by the operator still ends the token."""
    apitokens.forget()
    assert client.put("/api/settings", json={"api_tokens_allowed": True}).status_code == 200
    anna = make_account("anna")
    with new_client(anna) as browser:
        made = browser.post("/api/api-tokens", json={"name": "nexdeck"})
        assert made.status_code == 201, made.text
        token = str(made.json()["secret"])
    bearer = {"Authorization": f"Bearer {token}"}
    for number in range(MAX_FAILURES):
        # From senders of their own, as a stranger guessing would: the lock of the account is what counts here.
        brake.forget()
        _browser(f"198.51.100.{number + 1}").post("/api/auth/login",
                                                 json={"name": "anna", "password": f"guess {number}"})
    assert _row("anna").locked_until is not None
    program = TestClient(app, base_url="http://testserver")
    assert program.get("/api/v1/me", headers=bearer).status_code == 200
    assert client.post(f"/api/accounts/{anna.id}/block", json={"current_password": PASSWORD}).status_code == 204
    refused = program.get("/api/v1/me", headers=bearer)
    assert refused.status_code == 401 and _code(refused) == "token_invalid"
    apitokens.forget()


# --- A5: the brake per sender always counts ---------------------------------------------------------------------------


def _spray(count: int = 31) -> list[int]:
    """A stranger behind the same proxy tries one password against many names, with made-up X-Forwarded-For."""
    stranger = _browser()
    return [stranger.post("/api/auth/login", json={"name": f"guess{n}", "password": "summer2026"},
                          headers={"X-Forwarded-For": f"198.51.100.{n}"}).status_code for n in range(count)]


def _known(name: str, password: str = PASSWORD) -> TestClient:
    """A browser that signed in as ``name`` (and so holds its device cookie), signed out again."""
    brake.forget()
    browser = _browser()
    assert browser.post("/api/auth/login", json={"name": name, "password": password}).status_code == 200
    assert browser.cookies.get(DEVICE_COOKIE)
    browser.post("/api/auth/logout")
    return browser


def _sign_in(browser: TestClient, name: str, password: str = PASSWORD) -> None:
    brake.forget()
    assert browser.post("/api/auth/login", json={"name": name, "password": password}).status_code == 200


def _passes(browser: TestClient, name: str, password: str = PASSWORD) -> int:
    """After a stranger's guesses from the same address: in (200), or waiting like everybody (429)."""
    brake.forget()
    assert 429 in _spray()
    return browser.post("/api/auth/login", json={"name": name, "password": password}).status_code


def test_a5_a_made_up_forwarded_header_does_not_switch_off_the_brake_across_names(client: TestClient) -> None:
    """Without trusted proxies any X-Forwarded-For took the brake per sender away, and one password could be tried
    against any number of names. The header is ignored then, the connection counts."""
    sprayer = _browser("203.0.113.66")
    answers = [sprayer.post("/api/auth/login", json={"name": f"name{n}", "password": "summer2026"},
                            headers={"X-Forwarded-For": f"198.51.100.{n}"}).status_code for n in range(40)]
    assert 429 in answers and answers.index(429) <= 32


def test_a5_a_browser_known_to_that_name_passes_a_strangers_guessing(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    bob = make_account("bob")
    own = _known("anna")
    assert _passes(own, "anna") == 200
    own.post("/api/auth/logout")
    # Without that browser, with a made-up cookie or with one given to another name: the sender waits.
    assert _passes(_browser(), "anna") == 429
    forged = _browser()
    forged.cookies.set(DEVICE_COOKIE, f"{anna.id}.abc." + "0f" * 16, path="/api/auth")
    assert _passes(forged, "anna") == 429
    other = _browser()
    with SessionLocal() as db:
        row = db.get(Account, bob.id)
        assert row is not None
        other.cookies.set(DEVICE_COOKIE, device_token(db, row), path="/api/auth")
    assert _passes(other, "anna") == 429
    # The count per name stays for the known browser too.
    brake.forget()
    tries = [own.post("/api/auth/login", json={"name": "anna", "password": "wrong guess"}).status_code
             for _ in range(12)]
    assert 429 in tries


def test_a5_the_operator_gets_in_from_its_browser_while_a_stranger_guesses(client: TestClient,
                                                                           operator: Account) -> None:
    """The emergency way (``/notzugang`` signs in through the same route) included."""
    own = _known("tester")
    assert _passes(own, "tester") == 200
    assert _passes(_browser(), "tester") == 429


def _spray_name(name: str, count: int = 12) -> list[int]:
    """A stranger behind the same proxy guesses the password of one name only."""
    stranger = _browser()
    return [stranger.post("/api/auth/login", json={"name": name, "password": f"guess {n}"}).status_code
            for n in range(count)]


@pytest.mark.parametrize("name", ["tester", "anna"])
def test_a5_a_stranger_guessing_that_very_name_does_not_keep_its_known_browser_out(client: TestClient,
                                                                                   operator: Account,
                                                                                   name: str) -> None:
    """Behind a proxy nobody named, everybody has one address: the count per address and name would hold the own
    browser too after five guesses at the operator's (or the emergency account's) name. For a browser with a device
    cookie of that name the count per name goes with the browser (decided 2026-10-07)."""
    if name != "tester":
        make_account(name)
    own = _known(name)
    brake.forget()
    assert 429 in _spray_name(name)
    without = _browser().post("/api/auth/login", json={"name": name, "password": PASSWORD})
    assert without.status_code == 429, "without the cookie the sender waits"
    assert own.post("/api/auth/login", json={"name": name, "password": PASSWORD}).status_code == 200


def test_a5_the_known_browser_is_still_slowed_by_its_own_wrong_passwords(client: TestClient,
                                                                         operator: Account) -> None:
    own = _known("tester")
    brake.forget()
    tries = [own.post("/api/auth/login", json={"name": "tester", "password": f"wrong {n}"}).status_code
             for n in range(8)]
    assert tries[:5] == [401] * 5 and 429 in tries
    # The count is its own: another name from the same browser is not held by it.
    make_account("anna")
    assert own.post("/api/auth/login", json={"name": "anna", "password": PASSWORD}).status_code == 200


def test_a5_a_device_cookie_with_an_endless_account_number_is_no_cookie(client: TestClient, operator: Account) -> None:
    browser = _browser("192.0.2.77")
    browser.cookies.set(DEVICE_COOKIE, "9" * 40 + ".abc." + "0f" * 16, path="/api/auth")
    assert browser.post("/api/auth/login", json={"name": "tester", "password": PASSWORD}).status_code == 200


def test_a5_the_operator_hears_of_a_proxy_nobody_named(client: TestClient, operator: Account,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps, "_warned_unknown_proxy", False)
    assert client.get("/api/settings").json()["proxy_unknown"] is False
    assert client.get("/api/settings", headers={"X-Real-IP": "198.51.100.4"}).json()["proxy_unknown"] is True
    # Remembered for the next visit without the header, and gone once the proxy is named.
    assert client.get("/api/settings").json()["proxy_unknown"] is True
    monkeypatch.setattr(get_settings(), "trusted_proxies", "172.16.0.0/12")
    assert client.get("/api/settings", headers={"X-Forwarded-For": "198.51.100.4"}).json()["proxy_unknown"] is False
    with new_client(make_account("anna")) as member:
        assert member.get("/api/settings").status_code == 403


def test_a5_a_new_password_forgets_the_browsers_but_the_one_that_changed_it(client: TestClient,
                                                                             operator: Account) -> None:
    make_account("anna")
    old = _known("anna")
    changer = _browser()
    _sign_in(changer, "anna")
    assert changer.put("/api/auth/password", json={"current": PASSWORD, "new": NEW_PASSWORD}).status_code == 204
    changer.post("/api/auth/logout")
    assert _passes(old, "anna", NEW_PASSWORD) == 429
    assert _passes(changer, "anna", NEW_PASSWORD) == 200


def test_a5_a_device_cookie_from_before_a_new_password_does_not_open_the_lock(client: TestClient,
                                                                              operator: Account) -> None:
    make_account("anna")
    old = _known("anna")
    changer = _browser()
    _sign_in(changer, "anna")
    changer.put("/api/auth/password", json={"current": PASSWORD, "new": NEW_PASSWORD})
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name="anna").one()
        row.failed_logins, row.locked_until = MAX_FAILURES, utcnow() + timedelta(minutes=10)
        db.commit()
    brake.forget()
    assert old.post("/api/auth/login", json={"name": "anna", "password": NEW_PASSWORD}).status_code == 401
    assert changer.post("/api/auth/login", json={"name": "anna", "password": NEW_PASSWORD}).status_code == 200


@pytest.mark.parametrize("way", ["block", "password", "sign-out", "totp-reset"])
def test_a5_what_the_operator_does_to_an_account_forgets_its_browsers(client: TestClient, operator: Account,
                                                                      way: str) -> None:
    anna = make_account("anna")
    browser = _known("anna")
    confirm = {"current_password": PASSWORD}
    if way == "block":
        for path in ("block", "unblock"):
            assert client.post(f"/api/accounts/{anna.id}/{path}", json=confirm).status_code == 204
    elif way == "password":
        answer = client.put(f"/api/accounts/{anna.id}/password", json={**confirm, "password": PASSWORD})
        assert answer.status_code == 204
    elif way == "sign-out":
        assert client.post(f"/api/accounts/{anna.id}/sign-out").status_code == 204
    else:
        with SessionLocal() as db:
            row = db.get(Account, anna.id)
            assert row is not None
            row.totp_secret_enc = "sealed seed"
            db.commit()
        assert client.post(f"/api/accounts/{anna.id}/totp/reset", json=confirm).status_code == 200
    assert _passes(browser, "anna") == 429, way


def test_a5_signing_out_everywhere_forgets_the_others_and_keeps_this_one(client: TestClient,
                                                                         operator: Account) -> None:
    make_account("anna")
    other, keeper = _known("anna"), _browser()
    _sign_in(keeper, "anna")
    assert keeper.post("/api/auth/logout-all").status_code == 204
    keeper.post("/api/auth/logout")
    assert _passes(other, "anna") == 429
    assert _passes(keeper, "anna") == 200


def test_a5_a_new_account_under_the_id_of_a_deleted_one_knows_none_of_its_browsers(client: TestClient,
                                                                                   operator: Account) -> None:
    gone = make_account("zoe")
    browser = _known("zoe")
    deleted = client.request("DELETE", f"/api/accounts/{gone.id}", json={"current_password": PASSWORD})
    assert deleted.status_code == 204
    after = make_account("zora")
    assert after.id == gone.id, "SQLite gives the id of the deleted last account again"
    assert _passes(browser, "zora") == 429


def test_a5_any_way_a_password_or_block_changes_forgets_the_browsers(client: TestClient, operator: Account) -> None:
    """Also where no session is ended on the way (a block from nexsuite, a password set by a service)."""
    make_account("anna")
    for change in ("password", "block"):
        browser = _known("anna")
        with SessionLocal() as db:
            row = db.query(Account).filter_by(name="anna").one()
            if change == "password":
                row.password_hash = hash_password(PASSWORD)
            else:
                row.blocked_at = utcnow()
                db.commit()
                row.blocked_at = None
            db.commit()
        assert _passes(browser, "anna") == 429, change


def test_a5_signed_out_everywhere_in_nexsuite_forgets_the_browsers_once_per_moment(
    client: TestClient, operator: Account, world: dict, fake: FakeSuite
) -> None:
    """The emergency account (the operator here) keeps its password while connected: a browser known before nexsuite
    signed the person out everywhere would otherwise still pass the lock and the brake per sender."""
    connect(client, world, operator)
    browser = _known("tester")
    before = _row("tester").device_key
    fake.people["1"]["signed_out"] = (utcnow() - timedelta(hours=1)).isoformat()
    assert client.post("/api/suite/sync").status_code == 200
    after = _row("tester").device_key
    assert after != before
    assert _passes(browser, "tester") == 429
    # The same moment again changes nothing: a browser known since stays known.
    again = _known("tester")
    assert client.post("/api/suite/sync").status_code == 200
    assert _row("tester").device_key == after
    assert _passes(again, "tester") == 200


def test_a5_an_account_from_before_the_device_key_gets_one_at_its_next_sign_in(client: TestClient,
                                                                               operator: Account) -> None:
    """Accounts from before 0.3 have an empty key: no browser is known until the next sign-in, which draws one."""
    make_account("anna")
    with SessionLocal() as db:
        row = db.query(Account).filter_by(name="anna").one()
        row.device_key = ""
        db.commit()
    browser = _known("anna")
    assert _row("anna").device_key
    assert _passes(browser, "anna") == 200


# --- A7: pixels are counted before a picture is decoded ---------------------------------------------------------------


def _picture(kind: str, width: int, height: int) -> bytes:
    from PIL import Image

    if kind == "HEIF":
        import pillow_heif

        pillow_heif.register_heif_opener()
    out = io.BytesIO()
    mode = "1" if kind in ("PNG", "BMP", "GIF") else "L"
    Image.new(mode, (width, height)).save(out, kind)
    return out.getvalue()


@pytest.mark.parametrize("kind", ["PNG", "JPEG", "WEBP", "GIF", "BMP", "HEIF", "AVIF"])
def test_a7_a_picture_of_too_many_pixels_is_refused_before_anything_decodes_it(
    client: TestClient, operator: Account, space: int, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    # The line small, so the test stays small: 100 by 100 is a bomb here, 50 by 50 is not.
    monkeypatch.setattr(media_store, "MAX_PIXELS", 5_000)
    decoded: list[str] = []
    monkeypatch.setattr(media, "strip", lambda path, k: decoded.append("strip") or set())
    monkeypatch.setattr(media, "to_webp", lambda source, target: decoded.append("webp") or False)
    monkeypatch.setattr(media_store, "PREVIEW_SIDE", 10)
    monkeypatch.setattr(media_store, "_make_preview", lambda source, target: decoded.append("preview") or False)
    with SessionLocal() as db:
        settings_service.save(db, {"strip_location": True})
    picture = _picture(kind, 100, 100)
    assert media.sniff(picture[:64]) == {"HEIF": "heic", "JPEG": "jpeg"}.get(kind, kind.lower())
    big = client.post(f"/api/media?space={space}&name=big.{kind.lower()}", content=picture)
    assert big.status_code == 422, big.text
    assert big.json()["detail"]["code"] == "too_many_pixels" and big.json()["detail"]["max_million"] == 0
    assert decoded == []
    small = client.post(f"/api/media?space={space}&name=small.{kind.lower()}", content=_picture(kind, 50, 50))
    assert small.status_code == 201, small.text
    with SessionLocal() as db:
        assert db.query(Media).count() == 1


def test_a7_the_line_is_that_of_profile_pictures_and_the_message_names_it(client: TestClient, operator: Account,
                                                                          space: int,
                                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import avatars

    assert media_store.MAX_PIXELS == avatars.MAX_PIXELS == 50_000_000
    # Pillow's own refusal of a header far beyond its limit counts as too many, not as a picture of none.
    from PIL import Image

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1_000)
    answer = client.post(f"/api/media?space={space}&name=bomb.png", content=_picture("PNG", 100, 100))
    assert answer.status_code == 422 and answer.json()["detail"] == {
        "code": "too_many_pixels", "message": "This picture has more pixels than nexcanvas takes.", "max_million": 50}


def test_a7_a_preview_is_never_made_of_too_many_pixels(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # type: ignore[no-untyped-def]
    source, target = tmp_path / "big", tmp_path / "big.p"
    source.write_bytes(_picture("PNG", 100, 100))
    monkeypatch.setattr(media_store, "MAX_PIXELS", 5_000)
    assert media_store._make_preview(source, target) is False and not target.exists()
    monkeypatch.setattr(media_store, "MAX_PIXELS", 50_000)
    assert media_store._make_preview(source, target) is True and target.exists()


# --- A13: control characters in mail addresses and names --------------------------------------------------------------


@pytest.mark.parametrize("address", ["anna\x00@example.com", "anna@exa\x1bmple.com", "anna\x7f@example.com",
                                     "anna\x85@example.com", "anna@exa\x9bmple.com"])
def test_a13_a_mail_address_with_a_control_character_is_refused(client: TestClient, operator: Account, space: int,
                                                                address: str) -> None:
    invited = client.post(f"/api/spaces/{space}/invites", json={"email": address, "role": "read"})
    assert invited.status_code == 422 and _code(invited) == "invalid_email"
    assert _code(client.post("/api/invites", json={"email": address})) == "invalid_email"
    assert _code(client.post("/api/settings/mail-test", json={"to": address})) == "invalid_email"
    assert _code(client.put("/api/settings", json={"smtp_from": address})) == "invalid_email"


@pytest.mark.parametrize("address", ["anna@example.com\n", "anna@example.com\nBcc: x@example.com",
                                     "anna@example.com\r"])
def test_a13_the_mail_pattern_ends_at_the_end(address: str) -> None:
    """Every caller strips the address first; the pattern itself does not let a closing line break pass either."""
    from app.services import accounts

    assert accounts.EMAIL_PATTERN.match(address) is None
    assert accounts.EMAIL_PATTERN.match("anna@example.com") is not None


@pytest.mark.parametrize("name", ["Anna\x85Berg", "Anna\x9b31m", "Anna\x00", "Anna\x1b[31m", "Anna\x7f",
                                  "Anna\u202eBerg", "Anna\u200b"])
def test_a13_a_display_name_with_a_control_or_format_character_is_refused(client: TestClient, operator: Account,
                                                                         name: str) -> None:
    answer = client.put("/api/me/profile", json={"display_name": name})
    assert answer.status_code == 422 and _code(answer) == "display_name_invalid"


@pytest.mark.parametrize("name", ["Plan\x80ning", "Plan\x7f", "Plan\x9b31m", "Plan\x1b[31m", "Plan\x00"])
def test_a13_spaces_teams_and_boards_refuse_every_control_character(client: TestClient, operator: Account,
                                                                    space: int, name: str) -> None:
    for answer in (
        client.post("/api/spaces", json={"name": name}),
        client.patch(f"/api/spaces/{space}", json={"name": name}),
        client.post("/api/teams", json={"name": name, "members": [operator.id]}),
        client.post("/api/boards", json={"space_id": space, "title": name}),
        client.post("/api/board-templates", json={"space": space, "name": name, "content": {"items": [], "lines": []}}),
    ):
        assert answer.status_code == 422 and _code(answer) == "invalid_characters", answer.text
    team = client.post("/api/teams", json={"name": "Netz", "members": [operator.id]}).json()
    board = client.post("/api/boards", json={"space_id": space, "title": "Ideen"}).json()
    for answer in (client.patch(f"/api/teams/{team['id']}", json={"name": name}),
                   client.patch(f"/api/boards/{board['id']}", json={"title": name})):
        assert answer.status_code == 422 and _code(answer) == "invalid_characters", answer.text


def test_a13_names_keep_what_is_not_a_control_character(client: TestClient, operator: Account, space: int) -> None:
    """Emoji with a joiner and Persian with a non-joiner stay possible in names of spaces, teams and boards (format
    characters are refused in display names only, decided for the family)."""
    family, persian = "Familie \U0001F468\u200d\U0001F469\u200d\U0001F467", "می\u200cشود"
    assert client.post("/api/spaces", json={"name": family}).status_code == 201
    assert client.post("/api/teams", json={"name": persian, "members": [operator.id]}).status_code == 201
    assert client.post("/api/boards", json={"space_id": space, "title": "Ideen\twith a tab"}).status_code == 201


# --- E25: the same password is no new one -----------------------------------------------------------------------------


def test_e25_the_current_password_is_no_new_one_and_ends_nothing(client: TestClient, operator: Account) -> None:
    with new_client(operator) as other:
        answer = client.put("/api/auth/password", json={"current": PASSWORD, "new": PASSWORD})
        assert answer.status_code == 422 and _code(answer) == "password_unchanged"
        assert other.get("/api/auth/me").status_code == 200, "the other session goes on"
        assert client.put("/api/auth/password", json={"current": PASSWORD, "new": NEW_PASSWORD}).status_code == 204
        assert other.get("/api/auth/me").status_code == 401


# --- G12: mail without a mail server is a setting, not a failing server ----------------------------------------------


def test_g12_a_test_mail_without_a_mail_server_is_409_and_no_error_in_the_log(
    client: TestClient, operator: Account, space: int, caplog: pytest.LogCaptureFixture
) -> None:
    with SessionLocal() as db:
        settings_service.save(db, {"public_url": "https://canvas.example.com"})
    with caplog.at_level(logging.INFO):
        tested = client.post("/api/settings/mail-test", json={"to": "anna@example.com"})
        invited = client.post(f"/api/spaces/{space}/invites",
                              json={"email": "anna@example.com", "role": "read", "send": True})
        operator_invite = client.post("/api/invites", json={"email": "anna@example.com", "send": True})
    for answer in (tested, invited, operator_invite):
        assert answer.status_code == 409 and _code(answer) == "mail_off", answer.text
    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]
    # No invitation stands without anybody holding its link.
    with SessionLocal() as db:
        assert db.query(Invite).count() == 0


# --- D3: team leads change their teams only when the operator allows it ------------------------------------------------


def test_d3_a_lead_changes_the_team_only_when_the_operator_allows_it(client: TestClient, operator: Account) -> None:
    anna, ben = make_account("anna"), make_account("ben")
    team = client.post("/api/teams", json={"name": "Net", "members": [anna.id], "lead": anna.id}).json()
    assert client.get("/api/settings").json()["team_leads_edit"] is False, "off from the start"
    with new_client(anna) as lead:
        assert lead.get("/api/auth/me").json()["may_edit_led_teams"] is False
        refused = lead.patch(f"/api/teams/{team['id']}", json={"members": [anna.id, ben.id]})
        assert refused.status_code == 403 and _code(refused) == "team_leads_off"
    # The operator changes teams either way.
    assert client.patch(f"/api/teams/{team['id']}", json={"members": [anna.id, ben.id]}).status_code == 200
    assert client.get("/api/auth/me").json()["may_edit_led_teams"] is True
    assert client.put("/api/settings", json={"team_leads_edit": True}).json()["team_leads_edit"] is True
    with new_client(anna) as lead:
        assert lead.get("/api/auth/me").json()["may_edit_led_teams"] is True
        assert lead.patch(f"/api/teams/{team['id']}", json={"members": [anna.id]}).status_code == 200
    with new_client(ben) as member:
        refused = member.patch(f"/api/teams/{team['id']}", json={"members": [ben.id]})
        assert refused.status_code == 403 and _code(refused) == "forbidden", "a member who does not lead it"
    with new_client(anna) as lead:
        assert lead.put("/api/settings", json={"team_leads_edit": False}).status_code == 403


def test_d3_while_connected_nexsuite_keeps_the_teams_and_the_switch(client: TestClient, operator: Account,
                                                                      world: dict, fake: FakeSuite) -> None:
    assert client.put("/api/settings", json={"team_leads_edit": True}).status_code == 200
    connect(client, world, operator)
    refused = client.put("/api/settings", json={"team_leads_edit": False})
    assert refused.status_code == 409 and _code(refused) == "managed_by_suite"
    assert client.get("/api/auth/me").json()["may_edit_led_teams"] is False
    with new_client(world["anna"]) as lead:
        assert lead.get("/api/auth/me").json()["may_edit_led_teams"] is False
        refused = lead.patch(f"/api/teams/{world['team']}", json={"members": [world["anna"].id]})
        assert refused.status_code == 409 and _code(refused) == "managed_by_suite"


def test_d3_an_installation_from_before_starts_with_the_switch_off(client: TestClient, operator: Account) -> None:
    """Nothing is stored for it in an existing installation: the default answers, and it is off (decided
    2026-10-06 for nexcanvas, also for installations from before)."""
    with SessionLocal() as db:
        assert settings_service.get(db, "team_leads_edit") is False


# --- A16: a blocked account hears so after its right password ---------------------------------------------------------


def test_a16_a_blocked_account_hears_so_only_after_its_right_password(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    assert client.post(f"/api/accounts/{anna.id}/block", json={"current_password": PASSWORD}).status_code == 204
    brake.forget()
    wrong = _browser("192.0.2.30").post("/api/auth/login", json={"name": "anna", "password": "wrong guess"})
    assert wrong.status_code == 401 and _code(wrong) == "wrong_credentials"
    assert _row("anna").failed_logins == 1, "a wrong password counts towards the lock"
    right = _browser("192.0.2.31").post("/api/auth/login", json={"name": "anna", "password": PASSWORD})
    assert right.status_code == 403 and _code(right) == "account_blocked"
    assert right.json()["detail"]["message"] == "This account is blocked. Ask the operator to unblock it."
    assert not right.cookies.get("nexcanvas_session")
    # Locked after guessing, it says nothing more, blocked or not.
    with SessionLocal() as db:
        row = db.get(Account, anna.id)
        assert row is not None
        row.locked_until = utcnow() + timedelta(minutes=10)
        db.commit()
    locked = _browser("192.0.2.32").post("/api/auth/login", json={"name": "anna", "password": PASSWORD})
    assert locked.status_code == 401 and _code(locked) == "wrong_credentials"


def test_a16_the_code_step_checks_the_block_too(client: TestClient, operator: Account) -> None:
    anna = make_account("anna")
    with SessionLocal() as db:
        row = db.get(Account, anna.id)
        assert row is not None
        row.totp_secret_enc = "sealed seed"
        db.commit()
    browser = _browser("192.0.2.40")
    assert browser.post("/api/auth/login", json={"name": "anna", "password": PASSWORD}).json() == {
        "second_factor": True}
    # Blocked between the password and the code.
    assert client.post(f"/api/accounts/{anna.id}/block", json={"current_password": PASSWORD}).status_code == 204
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    answer = browser.post("/api/auth/login/totp", json={"code": code})
    assert answer.status_code == 403 and _code(answer) == "account_blocked"
    assert browser.get("/api/auth/me").status_code == 401

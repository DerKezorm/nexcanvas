"""The page's sentences for the server's error codes (Prüfgang H3, H18): every code the server sends has one in both
shipped languages, every sentence belongs to a code something still sends, and no API message is the code with its
underscores gone. As nextasks ``tests/test_texts.py``.

The codes are read from the source: ``error("code", ...)``, the typed errors (``BoardError("code")`` and the like),
the middleware's refusals, the keeper check and the sign-in redirects (``?error=code``). A code built at run time or
passed on from nexsuite is named in ``BUILT`` with where it comes from.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.models import Account

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "backend" / "app"
FRONTEND = ROOT / "frontend" / "src"

#: Codes put together at run time or passed on from nexsuite, with their source.
BUILT = {
    # services/suite.py: f"{what}_twice", f"{what}_unknown" for person, space, team
    "person_twice", "space_twice", "team_twice", "person_unknown", "space_unknown", "team_unknown",
}

#: Typed errors that carry an error code to the page.
TYPED = "Account|Avatar|Backup|Board|Canvas|Locale|Mail|Media|Notice|Oidc|Pack|Rights|Space|Suite|Team|Token"
RAISED = re.compile(
    rf"""(?:\berror|(?:{TYPED})Error|\brefuse\w*|_to_login|_to_account|_refuse\(\d+,)\(?\s*(?:db,\s*\w+,\s*)?"""
    r'''"([a-z][a-z0-9_]+)"'''
)


def _sources(folder: Path, suffixes: tuple[str, ...]) -> str:
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(folder.rglob("*"))
        if path.suffix in suffixes and ".test." not in path.name and "i18n" not in path.parts
    )


def server_codes() -> set[str]:
    from app.services import suite

    # services/suite.py PAIR_CODES: nexsuite's own codes, passed on when it refuses to pair; read from there, so a
    # code added to the list needs its sentence too.
    return set(RAISED.findall(_sources(APP, (".py",)))) | BUILT | set(suite.PAIR_CODES)


def texts(language: str) -> dict[str, str]:
    return json.loads((FRONTEND / "i18n" / f"{language}.json").read_text(encoding="utf-8"))["errors"]


def shared_texts(language: str) -> dict[str, str]:
    """The sentences the shared sign-in module brings for its fixed codes (``oidc.error``, ``oidc.formError``): the page
    falls back to them (``lib/errors.ts``)."""
    tree = json.loads((FRONTEND / "vendor" / "nexoidc" / f"oidc.{language}.json").read_text(encoding="utf-8"))["oidc"]
    return {**tree["error"], **tree["formError"]}


def test_the_scan_finds_the_codes_it_should() -> None:
    codes = server_codes()
    # One of each way in: error(), a typed error, a refusal of the middleware, the keeper check, a sign-in redirect,
    # a code a function hands back for a redirect, and a nexsuite refusal.
    assert {"not_found", "invalid_title", "client_required", "backups_emergency_only", "oidc_only_account",
            "managed_by_suite", "token_invalid", "display_name_too_long"} <= codes
    # A floor: the scan reads the whole server, not one file.
    assert len(codes) > 100
    assert {"app_still_connected", "app_not_reachable", "unknown_app"} <= codes


@pytest.mark.parametrize("language", ["de", "en"])
def test_every_code_the_server_sends_has_a_sentence(language: str) -> None:
    assert sorted(server_codes() - set(texts(language)) - set(shared_texts(language))) == []


def test_every_sentence_belongs_to_a_code_still_used() -> None:
    # Sent: a code the scan finds, a quoted code passed to a helper (a default argument, a code a function hands back
    # for a redirect), or one the page asks for itself (``'network'``, ``errorText('name_missing')``).
    backend, frontend = _sources(APP, (".py",)), _sources(FRONTEND, (".ts", ".tsx"))
    unused = [code for code in texts("de") if code not in server_codes() and f'"{code}"' not in backend
              and f"'{code}'" not in frontend and f"errors.{code}" not in frontend]
    assert unused == []
    # Of nexlore's leftovers, one hid behind a dictionary key of the same name ("locked" of an account).
    assert "locked" not in texts("de")


def test_no_api_message_is_the_code_spelt_out() -> None:
    source = _sources(APP, (".py",))
    assert ".code.replace(" not in source
    from app.services import avatars

    for code, text in avatars.MESSAGES.items():
        assert text.endswith(".") and text[0].isupper() and text.lower().rstrip(".") != code.replace("_", " ")
    raised = set(re.findall(r'AvatarError\(\s*"([a-z_]+)"', source))
    assert raised and sorted(raised - set(avatars.MESSAGES)) == []


def test_no_other_app_speaks_in_the_server() -> None:
    assert re.findall(r"notes\.example\.com|Give an address", _sources(APP, (".py",))) == []


def test_the_api_says_a_sentence_for_a_picture(client: TestClient, operator: Account) -> None:
    refused = client.put("/api/auth/avatar", content=b"not a picture").json()["detail"]
    assert refused["code"] == "avatar_not_a_picture"
    assert refused["message"] == "That is not a picture nexcanvas accepts (JPEG, PNG, WebP, GIF, HEIC or AVIF)."


def test_the_public_address_refusal_names_no_other_app(client: TestClient, operator: Account) -> None:
    refused = client.put("/api/settings", json={"public_url": "ftp://nowhere"}).json()["detail"]
    assert refused["code"] == "invalid_url"
    assert refused["message"] == "Enter an address starting with http:// or https://."


def test_a_file_that_is_not_there_answers_like_every_not_found(client: TestClient) -> None:
    for path in ("/assets/index-gone.js", "/api/no/such/route"):
        answer = client.get(path)
        assert answer.status_code == 404, path
        assert answer.json() == {"detail": {"code": "not_found", "message": "Not found."}}, path


def test_a_body_too_large_says_the_limit_its_sentence_names(client: TestClient, operator: Account) -> None:
    # "Die Datei ist größer als erlaubt ({{max_mb}} MB)": the guard in front of every route sends the number too,
    # as the upload routes do, so the page never shows the bare placeholder.
    from app.middleware import MAX_BODY

    refused = client.put("/api/settings", content=b"x" * (MAX_BODY + 1), headers={"Content-Type": "application/json"})
    assert refused.status_code == 413
    assert refused.json()["detail"] == {"code": "too_large", "message": "The request is too large.",
                                        "max_mb": MAX_BODY // (1024 * 1024)}

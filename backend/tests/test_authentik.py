"""The authentik button against a fake authentik API v3, and the blueprint download.

The fake answers the calls in the order the service makes them and records every request, so the tests can
check that the token travels only in the Authorization header, that the steps stop at the first failure and
that an existing provider is updated instead of duplicated. No network anywhere.
"""

from __future__ import annotations

import ast
import json
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Account
from app.security import encrypt_secret
from app.services import authentik, oidc, settings_service

from .conftest import make_account, sign_in

#: The test clients name their tab already (the header every change needs).
UI: dict[str, str] = {}


def invite_member(client: TestClient, name: str = "member") -> TestClient:
    browser = TestClient(app, base_url="http://testserver", headers={"X-Nexcanvas-Client": "tab-member00"})
    sign_in(browser, make_account(name))
    return browser

URL = "https://auth.example.com"
TOKEN = "one-time-token-that-must-stay-out-of-everything"
ISSUER = f"{URL}/application/o/nexcanvas/"
REDIRECT = "http://testserver/api/oidc/callback"


@dataclass
class Recorded:
    method: str
    path: str
    query: dict[str, str]
    auth: str
    body: dict | None


@dataclass
class FakeAuthentik:
    """authentik as a MockTransport handler. ``existing`` says which objects are already there."""

    existing: set[str] = field(default_factory=set)
    fail: tuple[str, str, int] | None = None
    discovery_ok: bool = True
    #: The address the existing provider "nexcanvas" sends people back to, and the client id it carries.
    provider_redirect: str = ""
    provider_client: str = "generated-client-id"
    #: More providers, each with its application: ``{"pk", "name", "client_id", "redirect", "slug"}``. The provider
    #: of another instance, or this one's own under a name with the host added.
    others: list[dict] = field(default_factory=list)
    calls: list[Recorded] = field(default_factory=list)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host != "auth.example.com":
            raise httpx.ConnectError("no such host")
        method, path = request.method, request.url.path
        query = dict(request.url.params.items())
        body = json.loads(request.content) if request.content else None
        self.calls.append(Recorded(method, path, query, request.headers.get("authorization", ""), body))
        if self.fail and (method, path) == self.fail[:2]:
            return httpx.Response(self.fail[2], text="<html>authentik error page</html>")
        if path.startswith("/application/o/nexcanvas") and path.endswith("/.well-known/openid-configuration"):
            if not self.discovery_ok:
                return httpx.Response(404, text="not found")
            issuer = f"{URL}{path.removesuffix('.well-known/openid-configuration')}"
            return httpx.Response(
                200,
                json={
                    "issuer": issuer,
                    "authorization_endpoint": f"{issuer}authorize/",
                    "token_endpoint": f"{URL}/application/o/token/",
                    "jwks_uri": f"{issuer}jwks/",
                },
            )
        if not path.startswith("/api/v3/"):
            return httpx.Response(404)
        if request.headers.get("authorization") == "Bearer expired-token":
            return httpx.Response(401, json={"detail": "Token invalid/expired"})
        if request.headers.get("authorization") != f"Bearer {TOKEN}":
            return httpx.Response(403, json={"detail": "Authentication credentials were not provided."})
        return self._api(method, path[len("/api/v3") :], query, body)

    def _api(self, method: str, path: str, query: dict[str, str], body: dict | None) -> httpx.Response:
        if (method, path) == ("GET", "/admin/version/"):
            return httpx.Response(200, json={"version_current": "2026.8.1", "version_latest": "2026.8.1"})
        if (method, path) == ("GET", "/crypto/certificatekeypairs/"):
            rows = [{"pk": "cert-uuid", "name": "nexcanvas"}] if "cert" in self.existing else []
            return httpx.Response(200, json={"results": rows})
        if (method, path) == ("POST", "/crypto/certificatekeypairs/generate/"):
            return httpx.Response(200, json={"pk": "cert-uuid", "name": body["common_name"]})
        if (method, path) == ("GET", "/propertymappings/provider/scope/"):
            rows = [
                {"pk": "map-openid", "managed": "goauthentik.io/providers/oauth2/scope-openid", "name": "authentik default OAuth Mapping: OpenID 'openid'"},
                {"pk": "map-profile", "managed": "goauthentik.io/providers/oauth2/scope-profile", "name": "authentik default OAuth Mapping: OpenID 'profile'"},
                {"pk": "map-email", "managed": "goauthentik.io/providers/oauth2/scope-email", "name": "authentik default OAuth Mapping: OpenID 'email'"},
            ]
            if "mapping" in self.existing:
                rows.append({"pk": "map-own", "managed": None, "name": "nexcanvas email_verified"})
            if "name" in query:
                rows = [row for row in rows if row["name"] == query["name"]]
            if "managed" in query:
                rows = [row for row in rows if row["managed"] == query["managed"]]
            return httpx.Response(200, json={"results": rows})
        if (method, path) == ("POST", "/propertymappings/provider/scope/"):
            return httpx.Response(201, json={"pk": "map-own", "name": body["name"], "scope_name": body["scope_name"]})
        if (method, path) == ("GET", "/flows/instances/"):
            if query.get("designation") == "authorization":
                rows = [
                    {"pk": "flow-explicit", "slug": "default-provider-authorization-explicit-consent"},
                    {"pk": "flow-implicit", "slug": "default-provider-authorization-implicit-consent"},
                ]
            else:
                rows = [{"pk": "flow-invalidation", "slug": "default-provider-invalidation-flow"}]
            return httpx.Response(200, json={"results": rows})
        if (method, path) == ("GET", "/providers/oauth2/"):
            rows = [{"pk": 7, "name": "nexcanvas", "client_id": self.provider_client}] if "provider" in self.existing else []
            if rows and self.provider_redirect:
                rows[0]["redirect_uris"] = [{"matching_mode": "strict", "url": self.provider_redirect}]
            rows += [
                {"pk": other["pk"], "name": other["name"], "client_id": other["client_id"],
                 "redirect_uris": [{"matching_mode": "strict", "url": other["redirect"]}]}
                for other in self.others
            ]
            for key in ("name", "client_id"):
                if key in query:
                    rows = [row for row in rows if row[key] == query[key]]
            return httpx.Response(200, json={"results": rows})
        if (method, path) in (("POST", "/providers/oauth2/"), ("PATCH", "/providers/oauth2/7/")):
            status = 201 if method == "POST" else 200
            client = "generated-client-id" if method == "POST" else self.provider_client
            return httpx.Response(status, json={**body, "pk": 7, "client_id": client, "client_secret": "generated-secret"})
        for other in self.others:
            if (method, path) == ("PATCH", f"/providers/oauth2/{other['pk']}/"):
                return httpx.Response(200, json={**body, "pk": other["pk"], "client_id": other["client_id"],
                                                  "client_secret": "generated-secret"})
            if (method, path) == ("PATCH", f"/core/applications/{other['slug']}/"):
                return httpx.Response(200, json={**body, "pk": f"app-{other['pk']}"})
        if (method, path) == ("GET", "/core/applications/"):
            rows = [{"pk": "app-uuid", "slug": "nexcanvas", "name": "nexcanvas"}] if "application" in self.existing else []
            rows += [{"pk": f"app-{other['pk']}", "slug": other["slug"], "name": other["name"]} for other in self.others]
            if "slug" in query:
                rows = [row for row in rows if row["slug"] == query["slug"]]
            return httpx.Response(200, json={"results": rows})
        if (method, path) in (("POST", "/core/applications/"), ("PATCH", "/core/applications/nexcanvas/")):
            return httpx.Response(201 if method == "POST" else 200, json={**body, "pk": "app-uuid"})
        return httpx.Response(404, json={"detail": f"no fake answer for {method} {path}"})


@pytest.fixture
def fake() -> Iterator[FakeAuthentik]:
    server = FakeAuthentik()
    transport = httpx.MockTransport(server)
    authentik.transport_for_tests = transport
    oidc.transport_for_tests = transport
    oidc.clear_cache()
    yield server
    authentik.transport_for_tests = None
    oidc.transport_for_tests = None
    oidc.clear_cache()


def run_setup(client: TestClient, url: str = URL, token: str = TOKEN) -> dict:
    response = client.post("/api/oidc/authentik/setup", json={"url": url, "token": token}, headers=UI)
    assert response.status_code == 200, response.text
    return response.json()


def steps(result: dict) -> list[tuple[str, bool]]:
    return [(step["key"], step["ok"]) for step in result["steps"]]


def stored() -> dict:
    with SessionLocal() as db:
        return {key: settings_service.get(db, key) for key in ("oidc_issuer", "oidc_client_id", "oidc_client_secret_enc", "oidc_provider_name")}


# ---------------------------------------------------------------------------
# The button
# ---------------------------------------------------------------------------


def test_setup_creates_everything_and_fills_the_configuration(
    client: TestClient, operator: Account, fake: FakeAuthentik
) -> None:
    result = run_setup(client)
    assert steps(result) == [(key, True) for key in authentik.STEP_KEYS]
    assert result["client_id"] == "generated-client-id"
    assert result["issuer"] == ISSUER
    assert "2026.8.1" in result["steps"][0]["detail"]

    # Stored, encrypted, and the sign-in page sees the button.
    values = stored()
    assert values["oidc_issuer"] == ISSUER and values["oidc_client_id"] == "generated-client-id"
    assert values["oidc_provider_name"] == "authentik"
    assert values["oidc_client_secret_enc"] and "generated-secret" not in values["oidc_client_secret_enc"]
    assert client.get("/api/oidc/state").json() == {"enabled": True, "provider_name": "authentik"}
    assert client.get("/api/oidc/config").json()["configured"] is True

    # The provider was created with what the task prescribes.
    created = [call for call in fake.calls if (call.method, call.path) == ("POST", "/api/v3/providers/oauth2/")]
    assert len(created) == 1
    body = created[0].body
    assert body["name"] == "nexcanvas" and body["client_type"] == "confidential"
    # authentik 2026.8 refuses every authorize request whose grant is not listed on the provider.
    assert body["grant_types"] == ["authorization_code"]
    assert body["redirect_uris"] == [{"matching_mode": "strict", "url": REDIRECT}]
    assert body["signing_key"] == "cert-uuid" and body["sub_mode"] == "user_uuid"
    assert body["authorization_flow"] == "flow-implicit" and body["invalidation_flow"] == "flow-invalidation"
    assert sorted(body["property_mappings"]) == ["map-openid", "map-own", "map-profile"]
    generated = [call for call in fake.calls if call.path == "/api/v3/crypto/certificatekeypairs/generate/"]
    assert generated[0].body["common_name"] == "nexcanvas" and generated[0].body["validity_days"] == 3650
    mapping = [call for call in fake.calls if (call.method, call.path) == ("POST", "/api/v3/propertymappings/provider/scope/")]
    assert mapping[0].body["scope_name"] == "email" and '"email_verified": True' in mapping[0].body["expression"]
    application = [call for call in fake.calls if (call.method, call.path) == ("POST", "/api/v3/core/applications/")]
    assert application[0].body == {"name": "nexcanvas", "slug": "nexcanvas", "provider": 7}
    assert not any(call.method == "PATCH" for call in fake.calls)


def test_token_travels_only_in_the_authorization_header(
    client: TestClient, operator: Account, fake: FakeAuthentik, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        result = run_setup(client)
    api_calls = [call for call in fake.calls if call.path.startswith("/api/v3/")]
    assert api_calls
    for call in api_calls:
        assert call.auth == f"Bearer {TOKEN}"
        assert TOKEN not in call.path and TOKEN not in str(call.query) and TOKEN not in json.dumps(call.body)
    assert TOKEN not in caplog.text
    assert TOKEN not in json.dumps(result)
    # Neither the token nor the secret ends up in the answer or the log.
    assert "generated-secret" not in json.dumps(result)
    assert "generated-secret" not in caplog.text


def test_steps_stop_at_the_first_failure_and_nothing_is_stored(
    client: TestClient, operator: Account, fake: FakeAuthentik
) -> None:
    fake.fail = ("POST", "/api/v3/crypto/certificatekeypairs/generate/", 500)
    result = run_setup(client)
    assert steps(result) == [("reached", True), ("signingKey", False)]
    failed = result["steps"][1]["detail"]
    assert "500" in failed and "generate" in failed
    assert (result["steps"][1]["reason"], result["steps"][1]["status"]) == ("answered", 500)
    assert "reason" not in result["steps"][0], "a step that worked carries no reason"
    assert TOKEN not in failed
    assert result["client_id"] == ""
    assert stored()["oidc_issuer"] == ""
    assert client.get("/api/oidc/state").json()["enabled"] is False
    # Nothing beyond the failed call was tried.
    assert not any(call.path.startswith("/api/v3/propertymappings") for call in fake.calls)


def test_unreachable_authentik_fails_at_the_first_step(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    result = run_setup(client, url="https://nowhere.example.com")
    assert steps(result) == [("reached", False)]
    assert "not reachable" in result["steps"][0]["detail"]
    assert result["steps"][0]["reason"] == "unreachable"


def test_wrong_token_is_reported_without_repeating_it(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    result = run_setup(client, token="wrong-token")
    assert steps(result) == [("reached", False)]
    assert "403" in result["steps"][0]["detail"]
    assert (result["steps"][0]["reason"], result["steps"][0]["status"]) == ("token", 403)
    assert "wrong-token" not in json.dumps(result)


def test_existing_objects_are_updated_not_duplicated(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    fake.existing = {"cert", "mapping", "provider", "application"}
    result = run_setup(client)
    assert steps(result) == [(key, True) for key in authentik.STEP_KEYS]
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/7/") in methods
    assert ("PATCH", "/api/v3/core/applications/nexcanvas/") in methods
    assert ("POST", "/api/v3/providers/oauth2/") not in methods
    assert ("POST", "/api/v3/core/applications/") not in methods
    assert ("POST", "/api/v3/crypto/certificatekeypairs/generate/") not in methods
    assert ("POST", "/api/v3/propertymappings/provider/scope/") not in methods
    assert "existing" in result["steps"][3]["detail"] and "existing" in result["steps"][4]["detail"]
    patched = next(call for call in fake.calls if call.method == "PATCH" and "providers" in call.path)
    assert patched.body["redirect_uris"] == [{"matching_mode": "strict", "url": REDIRECT}]
    # A provider made by an older button has no grant types; running the button again must add them.
    assert patched.body["grant_types"] == ["authorization_code"]
    assert sorted(patched.body["property_mappings"]) == ["map-openid", "map-own", "map-profile"]


def test_failed_discovery_after_storing_is_reported(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    """The values come from authentik and are stored; whether nexcanvas can reach the issuer is reported."""
    fake.discovery_ok = False
    result = run_setup(client)
    assert steps(result)[:5] == [(key, True) for key in authentik.STEP_KEYS[:5]]
    assert steps(result)[5] == ("filled", False)
    assert "discovery" in result["steps"][5]["detail"]
    assert stored()["oidc_client_id"] == "generated-client-id"


def test_setup_is_operator_only_and_checks_the_address(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    member = invite_member(client)
    response = member.post("/api/oidc/authentik/setup", json={"url": URL, "token": TOKEN}, headers=UI)
    assert response.status_code == 403
    bad = client.post("/api/oidc/authentik/setup", json={"url": "auth.example.com", "token": TOKEN}, headers=UI)
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "url_invalid"
    assert fake.calls == []


# ---------------------------------------------------------------------------
# The blueprint
# ---------------------------------------------------------------------------


class _TagLoader(yaml.SafeLoader):
    """Reads authentik's ``!Find`` and ``!KeyOf`` tags as plain values, enough to check the structure."""


_TagLoader.add_constructor("!Find", lambda loader, node: ("Find", loader.construct_sequence(node, deep=True)))
_TagLoader.add_constructor("!KeyOf", lambda loader, node: ("KeyOf", loader.construct_scalar(node)))


def test_blueprint_download_creates_the_same_objects(client: TestClient, operator: Account) -> None:
    response = client.get("/api/oidc/authentik/blueprint")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/yaml")
    assert response.headers["content-disposition"] == 'attachment; filename="nexcanvas-authentik.yaml"'
    text = response.text
    assert "!Find" in text and "!KeyOf" in text

    data = yaml.load(text, Loader=_TagLoader)
    assert data["version"] == 1
    models = [entry["model"] for entry in data["entries"]]
    assert models == [
        "authentik_providers_oauth2.scopemapping",
        "authentik_providers_oauth2.oauth2provider",
        "authentik_core.application",
    ]
    mapping, provider, application = data["entries"]
    assert mapping["identifiers"] == {"name": "nexcanvas email_verified"}
    assert mapping["attrs"]["scope_name"] == "email"
    assert '"email_verified": True' in mapping["attrs"]["expression"]
    attrs = provider["attrs"]
    assert attrs["client_type"] == "confidential" and attrs["sub_mode"] == "user_uuid"
    assert attrs["grant_types"] == ["authorization_code"]
    assert attrs["redirect_uris"] == [{"matching_mode": "strict", "url": REDIRECT}]
    assert attrs["authorization_flow"] == ("Find", ["authentik_flows.flow", ["slug", "default-provider-authorization-implicit-consent"]])
    assert attrs["signing_key"][0] == "Find" and attrs["signing_key"][1][0] == "authentik_crypto.certificatekeypair"
    assert ("KeyOf", "nexcanvas-email-verified") in attrs["property_mappings"]
    assert application["identifiers"] == {"slug": "nexcanvas"}
    assert application["attrs"]["provider"] == ("KeyOf", "nexcanvas-provider")


def test_a_second_instance_takes_names_of_its_own(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    """Prüfgang C12: another nexcanvas at the same authentik holds the plain names; taking them would send its people
    back here. The first one stays untouched, this one gets a provider, an application and an issuer of its own."""
    fake.existing = {"cert", "mapping", "provider", "application"}
    fake.provider_redirect = "https://first.example.com/api/oidc/callback"
    fake.provider_client = "the-first-instance"
    result = run_setup(client)
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/7/") not in methods, "the first instance's provider stays"
    assert ("PATCH", "/api/v3/core/applications/nexcanvas/") not in methods
    made = next(call for call in fake.calls if (call.method, call.path) == ("POST", "/api/v3/core/applications/"))
    assert made.body["slug"] == "nexcanvas-testserver" and made.body["name"] == "nexcanvas (testserver)"
    assert result["issuer"] == f"{URL}/application/o/nexcanvas-testserver/"
    fake.provider_redirect = REDIRECT
    fake.calls.clear()
    run_setup(client)
    assert ("PATCH", "/api/v3/providers/oauth2/7/") in [(c.method, c.path) for c in fake.calls], "its own: updated"


def test_its_own_provider_keeps_the_plain_names(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    """#job-165: the plain provider is this nexcanvas's own when it already sends people here, and also when it carries
    the client id stored here: the operator moved nexcanvas to a new address and runs the button again. Both update,
    the issuer stays and the accounts bound to it keep their sign-in."""
    fake.existing = {"cert", "mapping", "provider", "application"}
    fake.provider_redirect = REDIRECT
    run_setup(client)
    assert ("PATCH", "/api/v3/providers/oauth2/7/") in [(call.method, call.path) for call in fake.calls]
    assert stored()["oidc_client_id"] == "generated-client-id"
    fake.provider_redirect = "https://old-address.example.com/api/oidc/callback"
    fake.calls.clear()
    result = run_setup(client)
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/7/") in methods, "moved, still its own: updated"
    assert ("PATCH", "/api/v3/core/applications/nexcanvas/") in methods
    assert ("POST", "/api/v3/providers/oauth2/") not in methods
    assert result["issuer"] == ISSUER
    assert stored()["oidc_issuer"] == ISSUER


def test_an_address_that_cannot_be_used_says_so(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    """An address httpx cannot even form a request from fails with its own reason, not as "not reachable"."""
    result = run_setup(client, url="https://[::1")
    assert steps(result) == [("reached", False)]
    assert result["steps"][0]["reason"] == "unusable"


def test_every_step_the_server_sends_has_a_name_in_both_languages() -> None:
    """The list after "Set up" names each step from the language files, under the key the server sends. A file that
    spelled one differently ("fill" for "filled") showed the bare key; one without the names showed none at all."""
    src = Path(__file__).resolve().parents[2] / "frontend" / "src"
    page = (src / "pages" / "settings" / "ServerCards.tsx").read_text(encoding="utf-8")
    looked_up = re.search(r"t\(`([\w.]+)\.\$\{step\.key\}`", page)
    assert looked_up, "the step list no longer looks up a name by the step's key"
    for language in ("de", "en"):
        names = json.loads((src / "i18n" / f"{language}.json").read_text(encoding="utf-8"))
        for part in looked_up.group(1).split("."):
            names = names.get(part, {})
        missing = [key for key in authentik.STEP_KEYS if not str(names.get(key, "")).strip()]
        assert not missing, f"{language}.json has no name for {missing}"
        assert sorted(names) == sorted(authentik.STEP_KEYS), f"{language}.json names steps the server never sends"


def reasons_in_the_code() -> set[str]:
    """Every reason a failed step can carry: the words handed to ``StepFailed`` as its second argument or as
    ``reason=``, read from the module itself."""
    tree = ast.parse(Path(authentik.__file__).read_text(encoding="utf-8"))
    found: set[str] = set()
    for call in ast.walk(tree):
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "StepFailed"):
            continue
        given = call.args[1:2] + [keyword.value for keyword in call.keywords if keyword.arg == "reason"]
        for node in given:
            words = [part.value for part in ast.walk(node) if isinstance(part, ast.Constant)]
            found |= {word for word in words if isinstance(word, str)}
    return found


def test_every_reason_the_server_sends_has_a_sentence_in_both_languages() -> None:
    """A failed step shows its reason as a sentence in the operator's language, as in nexsuite (Prüfgang C4); a reason
    the files do not know would show the English line meant for the log."""
    reasons = reasons_in_the_code()
    assert {"unreachable", "unusable", "token", "answered"} <= reasons, reasons
    src = Path(__file__).resolve().parents[2] / "frontend" / "src"
    page = (src / "pages" / "settings" / "ServerCards.tsx").read_text(encoding="utf-8")
    looked_up = re.search(r"t\(`([\w.]+)\.\$\{step\.reason\}`", page)
    assert looked_up, "the step list no longer says a failed step's reason in words"
    for language in ("de", "en"):
        sentences = json.loads((src / "i18n" / f"{language}.json").read_text(encoding="utf-8"))
        for part in looked_up.group(1).split("."):
            sentences = sentences.get(part, {})
        missing = sorted(reason for reason in reasons if not str(sentences.get(reason, "")).strip())
        assert not missing, f"{language}.json has no sentence for {missing}"
        assert sorted(sentences) == sorted(reasons), f"{language}.json has sentences for reasons the server never sends"


OLD_HOST = "old.example.com"
OWN_SLUG = "nexcanvas-old-example-com"
OWN_ISSUER = f"{URL}/application/o/{OWN_SLUG}/"


def configured_as(issuer: str, client_id: str) -> int:
    """nexcanvas set up by an earlier run of the button, with one account bound to the provider; returns its id."""
    with SessionLocal() as db:
        settings_service.save(db, {"oidc_issuer": issuer, "oidc_client_id": client_id,
                                   "oidc_client_secret_enc": encrypt_secret("old-secret"), "oidc_provider_name": "authentik"})
        db.commit()
    member = make_account("bound")
    with SessionLocal() as db:
        row = db.get(Account, member.id)
        assert row is not None
        row.oidc_subject = "subject-1"
        db.commit()
    return member.id


def test_a_second_instance_keeps_its_own_provider_after_a_move(
    client: TestClient, operator: Account, fake: FakeAuthentik
) -> None:
    """The second nexcanvas at an authentik has a provider named after its old host. Moved to a new address, it finds
    that provider by the client id it stored and updates it: no third provider, the issuer stays, nobody's sign-in
    is dropped (Prüfer, block 3)."""
    fake.existing = {"cert", "mapping", "provider", "application"}
    fake.provider_redirect = "https://first.example.com/api/oidc/callback"
    fake.provider_client = "the-first-instance"
    fake.others = [{"pk": 8, "name": f"nexcanvas ({OLD_HOST})", "client_id": "own-client",
                    "redirect": f"https://{OLD_HOST}/api/oidc/callback", "slug": OWN_SLUG}]
    member = configured_as(OWN_ISSUER, "own-client")
    result = run_setup(client)
    assert steps(result) == [(key, True) for key in authentik.STEP_KEYS]
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/8/") in methods
    assert ("PATCH", f"/api/v3/core/applications/{OWN_SLUG}/") in methods
    assert ("POST", "/api/v3/providers/oauth2/") not in methods
    assert ("POST", "/api/v3/core/applications/") not in methods
    assert ("PATCH", "/api/v3/providers/oauth2/7/") not in methods, "the first instance's provider stays"
    patched = next(call for call in fake.calls if (call.method, call.path) == ("PATCH", "/api/v3/providers/oauth2/8/"))
    assert patched.body["name"] == f"nexcanvas ({OLD_HOST})"
    assert patched.body["redirect_uris"] == [{"matching_mode": "strict", "url": REDIRECT}]
    assert result["issuer"] == OWN_ISSUER and stored()["oidc_issuer"] == OWN_ISSUER
    with SessionLocal() as db:
        assert db.get(Account, member).oidc_subject == "subject-1"  # type: ignore[union-attr]


def test_a_stored_client_id_never_takes_over_another_instances_provider(
    client: TestClient, operator: Account, fake: FakeAuthentik
) -> None:
    """The client id stored here belongs to this instance's own provider, not to the one with the plain name, which
    another instance signs in with. While the own one is there, it is updated; once it is gone from authentik, a new
    one is made under this host's name and the other instance's provider is still left alone."""
    fake.existing = {"cert", "mapping", "provider", "application"}
    fake.provider_redirect = "https://first.example.com/api/oidc/callback"
    fake.provider_client = "the-first-instance"
    fake.others = [{"pk": 8, "name": "nexcanvas (testserver)", "client_id": "own-client", "redirect": REDIRECT,
                    "slug": "nexcanvas-testserver"}]
    configured_as(f"{URL}/application/o/nexcanvas-testserver/", "own-client")
    run_setup(client)
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/8/") in methods
    assert ("PATCH", "/api/v3/providers/oauth2/7/") not in methods
    fake.others = []
    fake.calls.clear()
    result = run_setup(client)
    methods = [(call.method, call.path) for call in fake.calls]
    assert ("PATCH", "/api/v3/providers/oauth2/7/") not in methods, "never the other instance's provider"
    assert ("PATCH", "/api/v3/core/applications/nexcanvas/") not in methods
    made = next(call for call in fake.calls if (call.method, call.path) == ("POST", "/api/v3/providers/oauth2/"))
    assert made.body["name"] == "nexcanvas (testserver)"
    assert result["issuer"] == f"{URL}/application/o/nexcanvas-testserver/"


def test_an_expired_token_is_named_as_the_token(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    result = run_setup(client, token="expired-token")
    assert steps(result) == [("reached", False)]
    assert (result["steps"][0]["reason"], result["steps"][0]["status"]) == ("token", 401)


def test_an_answer_without_json_carries_its_status(client: TestClient, operator: Account, fake: FakeAuthentik) -> None:
    """Something answers 200 with a web page: the page says so with that status, not with 0."""
    fake.fail = ("GET", "/api/v3/admin/version/", 200)
    result = run_setup(client)
    assert steps(result) == [("reached", False)]
    assert (result["steps"][0]["reason"], result["steps"][0]["status"]) == ("answered", 200)

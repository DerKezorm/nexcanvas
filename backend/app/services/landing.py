"""The page a sign-in lands on (Prüfgang B10): a direct link opened without a session survives the way through the
sign-in page and the provider. Only a page of nexcanvas' own is ever taken (no open redirect, Bauplan 06 "Verbund").
"""

from __future__ import annotations

import posixpath
import re
from urllib.parse import unquote

#: A page of nexcanvas' own to land on after the provider: a path on this server with its query. Never another host
#: (``//host``, ``/\host``, a scheme), never the API, nothing but printable characters without spaces.
_NEXT = re.compile(r"/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]{0,499}")


def safe_next(value: object) -> str | None:
    """The page to land on after signing in, or None if ``value`` is not one of nexcanvas' own (no open redirect).
    The API is no page: checked on the path as the server reads it, decoded and in small letters (``/%61pi/``,
    ``/API/``)."""
    if not isinstance(value, str) or not _NEXT.fullmatch(value) or value == "/":
        return None
    path = value.split("?", 1)[0]
    for _round in range(3):
        path = unquote(path)
    if path.startswith("//") or "\\" in path:
        return None
    # As a browser reads it: dot segments resolved (``/./api``, ``/x/../api``), in any case.
    path = posixpath.normpath(path).lower()
    if path == "/api" or path.startswith(("/api/", "//")):
        return None
    return value

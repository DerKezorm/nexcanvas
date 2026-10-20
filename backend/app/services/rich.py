"""The formatting inside an item's words, as the page writes it (``frontend/src/board/rich.ts``).

It lives in the item's shared text as attributes (Quill's way): bold, italic, underline, strike, a colour and a size
for a part, a bullet or numbered list on the newline that ends a line. A plain picture of a board carries it as
``rich``, a list of runs ``{"insert": "...", "attributes": {...}}``, only for items that have any.

What comes from outside (a copy, a template, an imported file) is cleaned to what the board knows; anything else is
dropped, never shown. The words themselves always stay the plain ``text``.
"""

from __future__ import annotations

import re
from typing import Any

from pycrdt import Text

LOOKS = ("bold", "italic", "underline", "strike")
SIZES = ("small", "large", "huge")
LISTS = ("bullet", "ordered")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
#: Runs one item's words may come in; more is no formatting anybody made by hand.
MAX_RUNS = 5000


def _clean_attributes(raw: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for look in LOOKS:
        if raw.get(look) is True:
            out[look] = True
    color = raw.get("color")
    if isinstance(color, str) and HEX.match(color):
        out["color"] = color.lower()
    if raw.get("size") in SIZES:
        out["size"] = raw["size"]
    if raw.get("list") in LISTS:
        out["list"] = raw["list"]
    return out


def clean_runs(value: Any) -> list[dict[str, Any]]:
    """Only words, with only what the board knows; neighbours that look alike are joined."""
    out: list[dict[str, Any]] = []
    if not isinstance(value, list):
        return out
    for op in value[:MAX_RUNS]:
        if not isinstance(op, dict) or not isinstance(op.get("insert"), str) or not op["insert"]:
            continue
        attributes = _clean_attributes(op.get("attributes"))
        if out and out[-1].get("attributes", {}) == attributes:
            out[-1]["insert"] += op["insert"]
            continue
        run: dict[str, Any] = {"insert": op["insert"]}
        if attributes:
            run["attributes"] = attributes
        out.append(run)
    return out


def has_marks(runs: list[dict[str, Any]]) -> bool:
    return any(run.get("attributes") for run in runs)


def plain_of(runs: list[dict[str, Any]]) -> str:
    return "".join(run["insert"] for run in runs)


def runs_of(text: Text) -> list[dict[str, Any]]:
    """The words of a shared text as runs, cleaned."""
    return clean_runs([{"insert": insert, "attributes": attributes or {}} for insert, attributes in text.diff()])


def rich_of(text: Text) -> list[dict[str, Any]] | None:
    """The runs of a shared text when it has any formatting, else None (plain words need none)."""
    runs = runs_of(text)
    return runs if has_marks(runs) else None


def words_of(item: dict[str, Any], limit: int = 100_000) -> tuple[str, list[dict[str, Any]] | None]:
    """The plain words of an item from a picture, and its formatting when it brings any that fits them: formatting
    for other words (the words were changed or emptied, the formatting left behind) is none."""
    text = item.get("text") if isinstance(item.get("text"), str) else ""
    runs = clean_runs(item.get("rich"))
    if has_marks(runs) and len(text) <= limit and plain_of(runs) == text:
        return text, runs
    return text[:limit], None


def fill(text: Text, runs: list[dict[str, Any]] | None, plain: str) -> None:
    """Puts the words into an empty shared text that is already part of a document: with their formatting, or plain."""
    words = plain_of(runs) if runs else plain
    if not words:
        return
    # All the words first, then the formatting of each run: a word put in after a formatted one would take its look.
    # pycrdt counts places in the text in bytes of UTF-8 (an "ö" is two), not in letters.
    text.insert(0, words)
    at = 0
    for run in runs or []:
        size = len(run["insert"].encode("utf-8"))
        if run.get("attributes"):
            text.format(at, at + size, run["attributes"])
        at += size


def put(texts: Any, key: str, plain: str, runs: list[dict[str, Any]] | None) -> None:
    """Sets an item's shared text in a map of texts (inside a transaction): a new one with these words."""
    texts[key] = Text()
    fill(texts[key], runs, plain)


def markdown(runs: list[dict[str, Any]]) -> str:
    """The words as Markdown, for JSON Canvas: bold, italic, struck through, underlined as HTML (Obsidian shows
    it), lists as ``- `` and ``1. ``. Colours and sizes have no Markdown; they ride along in the ``nexcanvas`` block."""
    lines: list[tuple[str | None, list[tuple[str, dict[str, Any]]]]] = []
    parts: list[tuple[str, dict[str, Any]]] = []
    for run in runs:
        attributes = run.get("attributes", {})
        pieces = run["insert"].split("\n")
        for number, piece in enumerate(pieces):
            if piece:
                parts.append((piece, attributes))
            if number < len(pieces) - 1:
                lines.append((attributes.get("list"), parts))
                parts = []
    if parts or not runs or not runs[-1]["insert"].endswith("\n"):
        lines.append((None, parts))
    out: list[str] = []
    counter = 0
    for kind, line in lines:
        counter = counter + 1 if kind == "ordered" else 0
        prefix = "- " if kind == "bullet" else f"{counter}. " if kind == "ordered" else ""
        out.append(prefix + "".join(_marked(piece, attributes) for piece, attributes in line))
    return "\n".join(out)


def _marked(piece: str, attributes: dict[str, Any]) -> str:
    # Marks hug the words: spaces at the edges stay outside, or Markdown would not see them.
    core = piece.strip(" ")
    if not core:
        return piece
    lead = piece[: len(piece) - len(piece.lstrip(" "))]
    tail = piece[len(piece.rstrip(" ")):]
    if attributes.get("underline"):
        core = f"<u>{core}</u>"
    if attributes.get("strike"):
        core = f"~~{core}~~"
    if attributes.get("italic"):
        core = f"*{core}*"
    if attributes.get("bold"):
        core = f"**{core}**"
    return lead + core + tail

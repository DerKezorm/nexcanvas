"""Shape packages (block 4): checking a package before it is kept.

A package comes from somewhere else (a file someone was sent, an SVG converted in a browser), so nothing of it is
taken as it is. Only the fields the format knows are copied, each against a rule: names as plain text, numbers as
finite numbers in a range, path data as path commands and numbers only, colours as roles or ``#rrggbb``. Whatever else
a file holds (scripts, links, styles, foreign keys) does not make it into what is kept. The page draws the elements
one by one from these fields, never as markup, so even a package that slipped past here could not run anything.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

#: The ids of the packages that come with nexcanvas; nobody installs a package under one of them.
BUILTIN_IDS = frozenset({
    "basic", "flow", "room", "project", "network", "uml", "bpmn", "house", "signs",
    "icons", "icons-devices", "icons-office", "icons-home", "icons-nature", "icons-arrows", "icons-people",
    "icons-media", "icons-signs",
})

MAX_BYTES = 2_000_000
MAX_SHAPES = 500
MAX_ELEMENTS = 300
MAX_PATH = 20_000
MAX_PER_SCOPE = 50

ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
LANG = re.compile(r"^[a-z]{2,3}(-[A-Z]{2})?$")
VERSION = re.compile(r"^[0-9A-Za-z.+-]{1,20}$")
PATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PAINTS = frozenset({"fill", "line", "ink", "soft", "paper", "none"})
ELEMENTS: dict[str, tuple[str, ...]] = {
    "path": (),
    "rect": ("x", "y", "width", "height"),
    "circle": ("cx", "cy", "r"),
    "ellipse": ("cx", "cy", "rx", "ry"),
    "line": ("x1", "y1", "x2", "y2"),
}


class PackError(Exception):
    def __init__(self, text: str) -> None:
        super().__init__(text)
        self.text = text


def _text(value: Any, most: int, what: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > most or any(ord(c) < 32 for c in value):
        raise PackError(f"{what} must be text of at most {most} characters.")
    return value.strip()


def _names(value: Any, what: str) -> dict[str, str]:
    if not isinstance(value, dict) or not 1 <= len(value) <= 20:
        raise PackError(f"{what} needs a name in at least one language.")
    out: dict[str, str] = {}
    for lang, name in value.items():
        if not isinstance(lang, str) or not LANG.match(lang):
            raise PackError(f"{what} has a name in an unknown language.")
        out[lang] = _text(name, 80, f"The name of {what.lower()}")
    return out


def _number(value: Any, low: float, high: float, what: str) -> float:
    finite = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if not finite or not low <= value <= high:
        raise PackError(f"{what} must be a number from {low:g} to {high:g}.")
    return round(float(value), 3)


def _paint(value: Any, what: str) -> str | None:
    if value is None:
        return None
    if value not in PAINTS:
        raise PackError(f"{what} must be one of {', '.join(sorted(PAINTS))}.")
    return str(value)


def _element(raw: Any, where: str) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("t") not in ELEMENTS:
        raise PackError(f"{where}: an element must be a path, rect, circle, ellipse or line.")
    kind = raw["t"]
    out: dict[str, Any] = {"t": kind}
    if kind == "path":
        d = raw.get("d")
        if not isinstance(d, str) or not d.strip() or len(d) > MAX_PATH or not PATH.match(d):
            raise PackError(f"{where}: a path must be path commands and numbers only.")
        out["d"] = " ".join(d.split())
    for key in ELEMENTS[kind]:
        out[key] = _number(raw.get(key), -100_000, 100_000, f"{where}: {key}")
    if kind == "rect" and raw.get("rx") is not None:
        out["rx"] = _number(raw["rx"], 0, 100_000, f"{where}: rx")
    for key in ("f", "s"):
        role = _paint(raw.get(key), f"{where}: {key}")
        if role is not None and not (kind == "line" and key == "f"):
            out[key] = role
    if raw.get("w") is not None:
        out["w"] = _number(raw["w"], 0, 50, f"{where}: w")
    if kind == "path":
        # A path may be moved and stretched into place (a drawing saved as a shape): numbers only, never a transform.
        moves = (("tx", -100_000, 100_000), ("ty", -100_000, 100_000), ("sx", 0.0001, 10_000), ("sy", 0.0001, 10_000))
        for key, low, high in moves:
            if raw.get(key) is not None:
                out[key] = _number(raw[key], low, high, f"{where}: {key}")
    if raw.get("dash") is True:
        out["dash"] = True
    return out


def _part_box(raw: Any, where: str) -> dict[str, float]:
    if not isinstance(raw, dict):
        raise PackError(f"{where} must be a box.")
    return {key: _number(raw.get(key), -2, 3, f"{where}: {key}") for key in ("x", "y", "w", "h")}


def check_shape(raw: Any, where: str = "A shape") -> dict[str, Any]:
    """One shape as kept: only the known fields, each checked."""
    if not isinstance(raw, dict):
        raise PackError(f"{where} must be an object.")
    shape_id = raw.get("id")
    if not isinstance(shape_id, str) or not ID.match(shape_id):
        raise PackError(f"{where} needs an id of lower case letters, digits and dashes.")
    where = f"Shape {shape_id}"
    out: dict[str, Any] = {"id": shape_id, "name": _names(raw.get("name"), where)}
    words = raw.get("words")
    if words is not None:
        if not isinstance(words, list) or len(words) > 20:
            raise PackError(f"{where}: at most 20 search words.")
        out["words"] = [_text(word, 40, f"{where}: a search word") for word in words]
    out["vw"] = _number(raw.get("vw"), 1, 10_000, f"{where}: vw")
    out["vh"] = _number(raw.get("vh"), 1, 10_000, f"{where}: vh")
    for key in ("w", "h"):
        if raw.get(key) is not None:
            out[key] = _number(raw[key], 1, 20_000, f"{where}: {key}")
    if raw.get("word") is not None:
        # The words a new one starts with (a number on a marker); plain text like a name.
        out["word"] = _text(raw["word"], 40, f"{where}: the first words")
    for key in ("keep", "quiet", "measure", "hollow"):
        if raw.get(key) is True:
            out[key] = True
    elements = raw.get("elements")
    if not isinstance(elements, list) or not 1 <= len(elements) <= MAX_ELEMENTS:
        raise PackError(f"{where} needs 1 to {MAX_ELEMENTS} elements.")
    out["elements"] = [_element(el, where) for el in elements]
    if raw.get("text") is not None:
        out["text"] = _part_box(raw["text"], f"{where}: text")
    if raw.get("outline") is not None:
        points = raw["outline"]
        if not isinstance(points, list) or not 3 <= len(points) <= 64:
            raise PackError(f"{where}: an outline has 3 to 64 corners.")
        out["outline"] = [
            {"x": _number(p.get("x") if isinstance(p, dict) else None, -1, 2, f"{where}: outline"),
             "y": _number(p.get("y") if isinstance(p, dict) else None, -1, 2, f"{where}: outline")}
            for p in points
        ]
    fill = raw.get("fill")
    if fill is not None:
        if fill != "none" and not (isinstance(fill, str) and HEX.match(fill)):
            raise PackError(f"{where}: fill must be none or #rrggbb.")
        out["fill"] = fill.lower()
    return out


def check(raw: Any) -> dict[str, Any]:
    """A whole package as kept. Accepts the file format (``{"format": "nexcanvas-shapes", "package": …}``) too."""
    if isinstance(raw, dict) and raw.get("format") == "nexcanvas-shapes":
        raw = raw.get("package")
    if not isinstance(raw, dict):
        raise PackError("This is not a shape package.")
    if len(json.dumps(raw, ensure_ascii=False)) > MAX_BYTES:
        raise PackError("This package is larger than 2 MB.")
    shapes = raw.get("shapes")
    if not isinstance(shapes, list) or len(shapes) > MAX_SHAPES:
        raise PackError(f"A package holds at most {MAX_SHAPES} shapes.")
    out: dict[str, Any] = {
        "name": _names(raw.get("name"), "The package"),
        "version": raw["version"] if isinstance(raw.get("version"), str) and VERSION.match(raw["version"]) else "1.0.0",
        "author": _text(raw["author"], 80, "The author") if raw.get("author") else "",
        "license": _text(raw["license"], 40, "The licence") if raw.get("license") else "",
        "shapes": [check_shape(shape, f"Shape {number + 1}") for number, shape in enumerate(shapes)],
    }
    seen: set[str] = set()
    for shape in out["shapes"]:
        if shape["id"] in seen:
            raise PackError(f"Two shapes are called {shape['id']}.")
        seen.add(shape["id"])
    return out


def file_of(data: dict[str, Any], package_id: str) -> dict[str, Any]:
    """The package as a file to pass on."""
    return {"format": "nexcanvas-shapes", "version": 1, "package": {"id": package_id, **data}}

"""Frames whose content is hidden, as a teacher hides the answers until it is time.

A frame with ``hidden: true`` covers what lies in it: everything whose middle is inside it (the rule by which a frame
takes its content along, ``inFrame`` in the browser), a smaller frame too, drawings on a PDF in it, and the lines that
end on any of these or end freely inside the frame. The frame itself, its name and place, stays visible.

Who may only read never gets the hidden content from the server: not live (``services/live.py`` keeps a document of
its own for them), not in the board's picture, the list, the export, the public page or the API, and the search does
not find its words. Who may write has the whole board in the browser, as before; the page covers what is hidden for
them, and shows it only to whoever hid it and to those who manage the space.

The same rule is in ``frontend/src/board/hiding.ts``; both are tested against ``tests/hiding_cases.json``.
"""

from __future__ import annotations

import math
from typing import Any

from . import rights


def _num(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def _box(item: dict[str, Any]) -> tuple[float, float, float, float]:
    return _num(item.get("x")), _num(item.get("y")), _num(item.get("w")), _num(item.get("h"))


def _inside(frame: dict[str, Any], x: float, y: float) -> bool:
    fx, fy, fw, fh = _box(frame)
    return fx <= x <= fx + fw and fy <= y <= fy + fh


def hiding_frames(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in items if item.get("kind") == "frame" and item.get("hidden") is True]


def hidden_ids(items: list[dict[str, Any]]) -> set[str]:
    """The ids of every item that lies hidden in a frame."""
    frames = hiding_frames(items)
    if not frames:
        return set()
    hidden: set[str] = set()
    for item in items:
        x, y, w, h = _box(item)
        middle = (x + w / 2, y + h / 2)
        for frame in frames:
            if item.get("id") == frame.get("id"):
                continue
            # A frame at least as large is no content of this one (it is the other way round).
            if item.get("kind") == "frame" and w * h >= _num(frame.get("w")) * _num(frame.get("h")):
                continue
            if _inside(frame, *middle):
                hidden.add(str(item.get("id")))
                break
    # Drawn on a page of a PDF that is hidden: hidden with it, wherever its middle lies.
    for item in items:
        on = item.get("on")
        if item.get("kind") == "ink" and isinstance(on, dict) and str(on.get("item")) in hidden:
            hidden.add(str(item.get("id")))
    return hidden


def hidden_line(line: dict[str, Any], hidden: set[str], frames: list[dict[str, Any]]) -> bool:
    for end in (line.get("a"), line.get("b")):
        if not isinstance(end, dict):
            continue
        if end.get("item"):
            if str(end["item"]) in hidden:
                return True
        elif any(_inside(frame, _num(end.get("x")), _num(end.get("y"))) for frame in frames):
            return True
    return False


def visible(picture: dict[str, Any]) -> dict[str, Any]:
    """The picture without what is hidden: what a reader may see."""
    items = [item for item in picture.get("items", []) if isinstance(item, dict)]
    frames = hiding_frames(items)
    if not frames:
        return picture
    hidden = hidden_ids(items)
    out = dict(picture)
    out["items"] = [item for item in items if str(item.get("id")) not in hidden]
    out["lines"] = [line for line in picture.get("lines", []) if isinstance(line, dict)
                    and not hidden_line(line, hidden, frames)]
    return out


def sees_hidden(role: str | None) -> bool:
    """Who may write has the whole board (the page covers it); who may only read gets it without."""
    return rights.at_least(role, rights.WRITE)


def for_role(picture: dict[str, Any], role: str | None) -> dict[str, Any]:
    return picture if sees_hidden(role) else visible(picture)

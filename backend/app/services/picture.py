"""A board as a small picture (SVG), for programs: a dashboard card shows the boards changed last.

The picture is what the overview in the app shows, simplified the same way: shapes, notes, frames and drawings as
they are; words, photos, files and links as plain boxes; lines straight from item to item. It is drawn in the dark or
the light look of the app, on the board's own background colour.

Nothing of a board reaches the picture as it is: every number is read as a number, every colour must be a colour, a
shape is one of the board's own kinds or a drawing of a package (shipped with nexcanvas, or carried by the board and
checked when the picture is made, ``boards.clean_defs``). So whatever a browser wrote into a board, the SVG holds no
script, no link and no text but the board's name, escaped.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

DATA = Path(__file__).resolve().parent.parent / "data" / "shipped_shapes.json"

HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
PATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$")

#: The app's two looks: the board, its ink, the boxes for photos and files.
LOOKS = {
    "dark": {"board": "#111117", "ink": "#f2f2f5", "box": "#1d1d26", "edge": "#3a3a46", "words": "#9a9aa8"},
    "light": {"board": "#fbfbfc", "ink": "#14141a", "box": "#ececf2", "edge": "#b4b4c2", "words": "#61616f"},
}
#: Board colours by name (``board/background.ts``); ``auto`` is the look's own.
NAMED = {"paper": "#ffffff", "cream": "#f6f0e1", "chalk": "#1f3b30", "blueprint": "#1e3a6b"}
#: Paper colours of notes (``board/palette.ts``).
NOTES = {
    "yellow": "#fde68a",
    "orange": "#fed7aa",
    "pink": "#fbcfe8",
    "violet": "#ddd6fe",
    "blue": "#bfdbfe",
    "green": "#bbf7d0",
    "gray": "#e4e4e7",
}
MAX_ITEMS = 2000


@lru_cache(maxsize=1)
def shipped() -> dict[str, dict[str, Any]]:
    """The drawings of the packages that come with nexcanvas, copied from the interface (a test keeps it current)."""
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _f(value: float) -> str:
    return f"{round(value, 2):g}"


def _light(color: str) -> bool:
    value = color.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    red, green, blue = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return 0.299 * red + 0.587 * green + 0.114 * blue > 150


def _colour(value: Any, ink: str) -> str | None:
    """A colour as written on an item: ``auto`` is the ink, ``none`` nothing, else only a hex colour."""
    if value == "auto":
        return ink
    if isinstance(value, str) and HEX.match(value):
        return value.lower()
    return None


def shape_path(kind: str, w: float, h: float) -> str:
    """The board's own shapes in a box of w by h (``board/geometry.ts`` ``shapePath``)."""
    if kind == "round":
        r = min(24, w / 4, h / 4)
        return (
            f"M{_f(r)} 0H{_f(w - r)}Q{_f(w)} 0 {_f(w)} {_f(r)}V{_f(h - r)}Q{_f(w)} {_f(h)} {_f(w - r)} {_f(h)}"
            f"H{_f(r)}Q0 {_f(h)} 0 {_f(h - r)}V{_f(r)}Q0 0 {_f(r)} 0Z"
        )
    if kind == "ellipse":
        half = f"{_f(w / 2)} {_f(h / 2)} 0 1 1"
        return f"M{_f(w / 2)} 0A{half} {_f(w / 2)} {_f(h)}A{half} {_f(w / 2)} 0Z"
    if kind == "triangle":
        return f"M{_f(w / 2)} 0L{_f(w)} {_f(h)}H0Z"
    if kind == "diamond":
        return f"M{_f(w / 2)} 0L{_f(w)} {_f(h / 2)}L{_f(w / 2)} {_f(h)}L0 {_f(h / 2)}Z"
    if kind == "hexagon":
        return (
            f"M{_f(w * 0.25)} 0H{_f(w * 0.75)}L{_f(w)} {_f(h / 2)}L{_f(w * 0.75)} {_f(h)}H{_f(w * 0.25)}L0 {_f(h / 2)}Z"
        )
    if kind == "star":
        points = []
        for i in range(10):
            angle = -math.pi / 2 + i * math.pi / 5
            r = 0.5 if i % 2 == 0 else 0.21
            points.append(
                f"{_f(w / 2 + math.cos(angle) * w * r)} {_f(h / 2 + math.sin(angle) * h * r * 1.05 + h * 0.04)}"
            )
        return "M" + "L".join(points) + "Z"
    if kind == "arrow":
        return f"M0 {_f(h * 0.3)}H{_f(w * 0.62)}V0L{_f(w)} {_f(h / 2)}L{_f(w * 0.62)} {_f(h)}V{_f(h * 0.7)}H0Z"
    if kind == "speech":
        r = min(20, w / 5, h / 5)
        bh = h * 0.78
        return (
            f"M{_f(r)} 0H{_f(w - r)}Q{_f(w)} 0 {_f(w)} {_f(r)}V{_f(bh - r)}Q{_f(w)} {_f(bh)} {_f(w - r)} {_f(bh)}"
            f"H{_f(w * 0.38)}L{_f(w * 0.18)} {_f(h)}L{_f(w * 0.22)} {_f(bh)}H{_f(r)}Q0 {_f(bh)} 0 {_f(bh - r)}"
            f"V{_f(r)}Q0 0 {_f(r)} 0Z"
        )
    return f"M0 0H{_f(w)}V{_f(h)}H0Z"


def _role(role: Any, fill: str | None, line: str | None, ink: str, board: str) -> tuple[str, float]:
    """A colour role of a package's drawing (``library/LibShape.tsx``) as a colour and its opacity."""
    if role == "fill":
        return (fill or board), 1.0
    if role == "line":
        return (line or ink), 1.0
    if role == "ink":
        if line:
            return line, 1.0
        return (("#1c1917" if _light(fill) else "#fafafa") if fill else ink), 1.0
    if role == "soft":
        return (line or ink), 0.16
    if role == "paper":
        return board, 1.0
    return "none", 1.0


def _drawing(
    drawing: dict[str, Any],
    fill: str | None,
    line: str | None,
    ink: str,
    board: str,
    x: float,
    y: float,
    w: float,
    h: float,
) -> list[str]:
    vw, vh = _num(drawing.get("vw"), 1) or 1, _num(drawing.get("vh"), 1) or 1
    out = [f'<g transform="translate({_f(x)} {_f(y)}) scale({_f(w / vw)} {_f(h / vh)})">']
    for element in drawing.get("elements", [])[:300]:
        if not isinstance(element, dict):
            continue
        kind = element.get("t")
        face, face_opacity = _role(element.get("f"), fill, line, ink, board) if kind != "line" else ("none", 1.0)
        edge, edge_opacity = _role(element.get("s"), fill, line, ink, board)
        # As in the app: the lines keep their width however the drawing is stretched.
        width = min(max(_num(element.get("w"), 2), 0), 50)
        look = (
            f' fill="{face}" fill-opacity="{_f(face_opacity)}" stroke="{edge}" stroke-opacity="{_f(edge_opacity)}"'
            f' stroke-width="{_f(width)}" stroke-linecap="round" stroke-linejoin="round"'
            ' vector-effect="non-scaling-stroke"'
        )
        if kind == "path":
            d = element.get("d")
            if not isinstance(d, str) or not PATH.match(d) or len(d) > 20_000:
                continue
            moved = ""
            if any(key in element for key in ("tx", "ty", "sx", "sy")):
                moved = (
                    f' transform="translate({_f(_num(element.get("tx")))} {_f(_num(element.get("ty")))}) '
                    f'scale({_f(_num(element.get("sx"), 1))} {_f(_num(element.get("sy"), 1))})"'
                )
            out.append(f'<path d="{d}"{moved}{look}/>')
        elif kind == "rect":
            out.append(
                f'<rect x="{_f(_num(element.get("x")))}" y="{_f(_num(element.get("y")))}" '
                f'width="{_f(max(0, _num(element.get("width"))))}" height="{_f(max(0, _num(element.get("height"))))}" '
                f'rx="{_f(max(0, _num(element.get("rx"))))}"{look}/>'
            )
        elif kind == "circle":
            out.append(
                f'<circle cx="{_f(_num(element.get("cx")))}" cy="{_f(_num(element.get("cy")))}" '
                f'r="{_f(max(0, _num(element.get("r"))))}"{look}/>'
            )
        elif kind == "ellipse":
            out.append(
                f'<ellipse cx="{_f(_num(element.get("cx")))}" cy="{_f(_num(element.get("cy")))}" '
                f'rx="{_f(max(0, _num(element.get("rx"))))}" ry="{_f(max(0, _num(element.get("ry"))))}"{look}/>'
            )
        elif kind == "line":
            out.append(
                f'<line x1="{_f(_num(element.get("x1")))}" y1="{_f(_num(element.get("y1")))}" '
                f'x2="{_f(_num(element.get("x2")))}" y2="{_f(_num(element.get("y2")))}"{look}/>'
            )
    out.append("</g>")
    return out


def svg(picture: dict[str, Any], title: str, look: str = "dark", width: int = 480) -> str:
    """The board's picture as an SVG of ``width`` pixels, 16 to 10, the board fitted in."""
    colours = LOOKS.get(look, LOOKS["dark"])
    background = picture.get("background") if isinstance(picture.get("background"), dict) else {}
    named = background.get("color") if isinstance(background, dict) else None
    board = NAMED.get(str(named), "") or (named if isinstance(named, str) and HEX.match(named) else colours["board"])
    ink = "#14141a" if _light(board) else "#f2f2f5"
    items = [item for item in picture.get("items", [])[:MAX_ITEMS] if isinstance(item, dict)]
    lines = [line for line in picture.get("lines", [])[:MAX_ITEMS] if isinstance(line, dict)]
    defs = picture.get("defs") if isinstance(picture.get("defs"), dict) else {}
    height = round(width * 10 / 16)

    boxes = []
    for item in items:
        x, y = _num(item.get("x")), _num(item.get("y"))
        w, h = max(1.0, _num(item.get("w"), 1)), max(1.0, _num(item.get("h"), 1))
        boxes.append((x, y, w, h))
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
    if not boxes:
        return (
            head + f'viewBox="0 0 {width} {height}"><title>{escape(title)}</title>'
            f'<rect width="{width}" height="{height}" fill="{board}"/></svg>'
        )
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[0] + b[2] for b in boxes)
    bottom = max(b[1] + b[3] for b in boxes)
    pad = max(right - left, bottom - top) * 0.06 + 20
    vx, vy, vw, vh = left - pad, top - pad, right - left + 2 * pad, bottom - top + 2 * pad
    # 16 to 10 around the middle, so the board sits in the card as in the app.
    if vw / vh > 1.6:
        grow = vw / 1.6 - vh
        vy, vh = vy - grow / 2, vh + grow
    else:
        grow = vh * 1.6 - vw
        vx, vw = vx - grow / 2, vw + grow
    scale = vw / width
    out = [
        head + f'viewBox="{_f(vx)} {_f(vy)} {_f(vw)} {_f(vh)}"><title>{escape(title)}</title>',
        f'<rect x="{_f(vx)}" y="{_f(vy)}" width="{_f(vw)}" height="{_f(vh)}" fill="{board}"/>',
    ]

    middles = {str(item.get("id")): (x + w / 2, y + h / 2) for item, (x, y, w, h) in zip(items, boxes, strict=True)}
    for line in lines:
        ends = []
        for end in (line.get("a"), line.get("b")):
            if not isinstance(end, dict):
                break
            ends.append(
                middles.get(str(end.get("item"))) if end.get("item") else (_num(end.get("x")), _num(end.get("y")))
            )
        if len(ends) != 2 or None in ends:
            continue
        colour = _colour(line.get("color"), ink) or ink
        stroke = max(1.0, _num(line.get("width"), 2)) * 1.5
        out.append(
            f'<line x1="{_f(ends[0][0])}" y1="{_f(ends[0][1])}" x2="{_f(ends[1][0])}" y2="{_f(ends[1][1])}" '
            f'stroke="{colour}" stroke-width="{_f(stroke)}" stroke-linecap="round"/>'
        )

    # Frames under everything, then the rest as they lie.
    order = sorted(range(len(items)), key=lambda i: (items[i].get("kind") != "frame", _num(items[i].get("z"))))
    for index in order:
        item, (x, y, w, h) = items[index], boxes[index]
        kind = item.get("kind")
        turn = _num(item.get("rot"))
        if turn:
            out.append(f'<g transform="rotate({_f(turn)} {_f(x + w / 2)} {_f(y + h / 2)})">')
        if kind == "note":
            paper = NOTES.get(str(item.get("color")), NOTES["yellow"])
            out.append(f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(h)}" rx="6" fill="{paper}"/>')
        elif kind == "shape":
            fill = _colour(item.get("fill"), ink)
            line = _colour(item.get("stroke"), ink)
            lib = item.get("lib")
            drawing = None
            if isinstance(lib, str):
                drawing = shipped().get(lib) or (defs.get(lib) if isinstance(defs.get(lib), dict) else None)
            if drawing is not None:
                out.extend(_drawing(drawing, fill, line, ink, board, x, y, w, h))
            else:
                # A kind the board does not know is drawn as a rectangle (``shape_path``).
                kind_of = str(item.get("shape"))
                stroke = f' stroke="{line}" stroke-width="{_f(3)}"' if line else ""
                out.append(
                    f'<path transform="translate({_f(x)} {_f(y)})" d="{shape_path(kind_of, w, h)}" '
                    f'fill="{fill or "none"}"{stroke}/>'
                )
        elif kind == "text":
            words = len(str(item.get("text", "")))
            bar = min(w, words * (22 if item.get("size") == "xl" else 12)) or min(w, 60)
            out.append(
                f'<rect x="{_f(x)}" y="{_f(y + h * 0.3)}" width="{_f(bar)}" height="{_f(h * 0.4)}" rx="4" '
                f'fill="{colours["words"]}" fill-opacity="0.6"/>'
            )
        elif kind == "frame":
            edge = _colour(item.get("color"), ink) or colours["edge"]
            out.append(
                f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(h)}" rx="14" fill="{colours["box"]}" '
                f'fill-opacity="0.6" stroke="{edge}" stroke-width="{_f(3 * max(scale, 1))}"/>'
            )
        elif kind == "ink":
            points = item.get("points") if isinstance(item.get("points"), list) else []
            ow, oh = max(1.0, _num(item.get("ow"), w)), max(1.0, _num(item.get("oh"), h))
            path = []
            for point in points[:5000]:
                if isinstance(point, list) and len(point) >= 2:
                    path.append(f"{_f(x + _num(point[0]) * w / ow)} {_f(y + _num(point[1]) * h / oh)}")
            if len(path) >= 2:
                colour = _colour(item.get("color"), ink) or ink
                opacity = "0.45" if item.get("marker") else "1"
                out.append(
                    f'<path d="M{"L".join(path)}" fill="none" stroke="{colour}" stroke-opacity="{opacity}" '
                    f'stroke-width="{_f(max(1.0, _num(item.get("size"), 3)))}" stroke-linecap="round" '
                    f'stroke-linejoin="round"/>'
                )
        else:
            # Photos, files, links: a box where they lie (a picture for programs carries no files).
            out.append(
                f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(h)}" rx="10" fill="{colours["box"]}" '
                f'stroke="{colours["edge"]}" stroke-width="{_f(2 * max(scale, 1))}"/>'
            )
        if turn:
            out.append("</g>")
    out.append("</svg>")
    return "".join(out)

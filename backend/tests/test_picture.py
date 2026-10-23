"""The board's picture for programs draws in the order the board does (``board/order.ts``)."""

from __future__ import annotations

from typing import Any

from app.services import picture


def _order(items: list[dict[str, Any]]) -> list[str]:
    boxes = [(float(i["x"]), float(i["y"]), float(i["w"]), float(i["h"])) for i in items]
    return [str(items[n]["id"]) for n in picture.draw_order(items, boxes)]


def _item(id: str, kind: str, x: float, y: float, w: float, h: float, z: int = 0) -> dict[str, Any]:
    return {"id": id, "kind": kind, "x": x, "y": y, "w": w, "h": h, "z": z}


PDF = _item("pdf", "file", 0, 0, 300, 400, 1)


def test_a_frame_drawn_onto_a_part_of_a_pdf_lies_over_it_and_what_comes_later_over_the_frame() -> None:
    items = [_item("a", "note", 500, 0, 50, 50, 0), _item("f", "frame", 20, 300, 200, 80), PDF,
             _item("n", "note", 40, 320, 60, 40, 2)]
    assert _order(items) == ["a", "pdf", "f", "n"]


def test_a_frame_around_a_whole_pdf_or_only_touching_it_lies_under_everything() -> None:
    assert _order([PDF, _item("g", "frame", -20, -20, 340, 440)]) == ["g", "pdf"]
    assert _order([PDF, _item("c", "frame", 250, 350, 300, 300)]) == ["c", "pdf"]


def test_the_smaller_of_two_frames_lies_over_the_larger() -> None:
    small = _item("small", "frame", 10, 10, 50, 50)
    big = _item("big", "frame", 0, 0, 500, 500)
    assert _order([small, big]) == ["big", "small"]


def test_a_shape_keeps_its_outline_width_in_the_picture() -> None:
    shape = {**_item("s", "shape", 0, 0, 100, 80), "shape": "rect", "fill": "none", "stroke": "#ff0000", "weight": 5}
    drawn = picture.svg({"items": [shape], "lines": []}, "Board")
    assert 'stroke-width="6"' in drawn
    for odd in (None, "thick", -1, 1e9):
        plain = picture.svg({"items": [{**shape, "weight": odd}], "lines": []}, "Board")
        assert 'stroke-width="3"' in plain


def test_a_frame_without_fill_shows_only_its_edge_in_the_picture() -> None:
    frame = {**_item("f", "frame", 0, 0, 200, 100), "title": "Answers", "color": "#ff0000"}
    filled = picture.svg({"items": [frame], "lines": []}, "Board")
    clear = picture.svg({"items": [{**frame, "clear": True}], "lines": []}, "Board")
    assert 'rx="14" fill="none"' not in filled
    assert 'rx="14" fill="none"' in clear
    # Only a real yes clears it.
    assert 'rx="14" fill="none"' not in picture.svg({"items": [{**frame, "clear": "yes"}], "lines": []}, "Board")

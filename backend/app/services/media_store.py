"""Photos and files put on boards.

Each lies in the media folder under its id, with a row in ``media`` that says what it is (found from the bytes, never
from the name), in which space it lives, and its size. The rights of the space decide who may see it. The same bytes
uploaded twice into one space are kept once.

On the way in, place and device are taken out of photos and videos (``services/media.py``, the operator can turn it
off); a HEIC photo, which browsers cannot show, is kept as an upright WebP instead. PDFs learn their page count.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Account, Media
from . import avatars, media, settings_service

logger = logging.getLogger("nexcanvas.media")

#: What a browser shows by itself, by kind; everything else is offered as a download.
SHOWN = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "bmp": "image/bmp",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
}
IMAGES = {"jpeg", "png", "gif", "webp", "avif", "bmp"}
MAX_NAME = 200
#: Pixels a picture may have, the same line as for profile pictures: a PNG of a few hundred kilobytes can open as
#: gigabytes (11,000 by 11,000 took the server of a sister app past 1 GB, Prüfgang 05.10.2026 A7).
MAX_PIXELS = avatars.MAX_PIXELS


class MediaError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status

    def values(self) -> dict[str, int]:
        """What the message names, for the page to say it in its language."""
        return {"max_million": MAX_PIXELS // 1_000_000} if self.code == "too_many_pixels" else {}


@dataclass
class Stored:
    id: str
    name: str
    kind: str
    mime: str
    size: int
    width: int
    height: int
    pages: int
    #: What was taken out of a photo: ``location``, ``device``, ``metadata``, ``unchecked``.
    removed: list[str]
    #: The same bytes were in the space already; this is that file.
    known: bool


def root() -> Path:
    path = get_settings().media_dir
    assert path is not None
    path.mkdir(parents=True, exist_ok=True)
    return path


def path_of(media_id: str) -> Path:
    return root() / media_id


#: Photos larger than this (on their longer side) get a smaller copy for showing on the board.
PREVIEW_SIDE = 1600


def preview_of(media_id: str) -> Path:
    """The smaller copy of a photo, next to it (ids never hold a dot, so the name is never another id)."""
    return root() / f"{media_id}.p"


def _make_preview(source: Path, target: Path) -> bool:
    """A WebP of at most ``PREVIEW_SIDE`` pixels on its longer side, upright, without any metadata. Never of a picture
    of more than ``MAX_PIXELS``: counted from its header first, before anything decodes it."""
    if _pixels(source) > MAX_PIXELS:
        return False
    try:
        from PIL import Image, ImageOps

        with Image.open(source) as image:
            if getattr(image, "is_animated", False):
                return False
            upright = ImageOps.exif_transpose(image)
            upright.thumbnail((PREVIEW_SIDE, PREVIEW_SIDE))
            if upright.mode not in ("RGB", "RGBA"):
                upright = upright.convert("RGBA" if "A" in upright.getbands() else "RGB")
            upright.save(target, "WEBP", quality=82, method=4)
        return True
    except Exception as exc:  # noqa: BLE001 - a broken picture fails in the decoder's own way
        logger.info("No preview for a picture: %s", type(exc).__name__)
        target.unlink(missing_ok=True)
        return False


def temporary() -> Path:
    return root() / f".upload-{secrets.token_hex(8)}"


def clean_name(name: str) -> str:
    text = "".join(char for char in name if ord(char) >= 32 and char not in '\\/:*?"<>|').strip(" .")
    return (text or "file")[:MAX_NAME]


def max_bytes(db: Session) -> int:
    return settings_service.upload_max_mb(db) * 1024 * 1024


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _picture_size(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            # Upright as shown: a portrait photo is stored lying with an orientation tag.
            orientation = image.getexif().get(0x0112, 1)
            width, height = image.size
            if orientation in (5, 6, 7, 8):
                width, height = height, width
            return width, height
    except Exception:  # noqa: BLE001 - a broken picture fails in the decoder's own way
        return 0, 0


def _pixels(path: Path, kind: str = "") -> int:
    """Width times height from the picture's header, before a pixel is decoded; 0 when it cannot be read."""
    try:
        from PIL import Image

        if kind == "heic":
            import pillow_heif

            pillow_heif.register_heif_opener()
        with Image.open(path) as image:
            return int(image.width) * int(image.height)
    except Exception as exc:  # noqa: BLE001 - a broken picture fails in the decoder's own way
        # Pillow refuses a header beyond twice its own limit before reading on: as many pixels as that, at least.
        if type(exc).__name__ == "DecompressionBombError":
            return MAX_PIXELS + 1
        return 0


def _pdf_pages(path: Path) -> int:
    try:
        from pypdf import PdfReader

        return len(PdfReader(path).pages)
    except Exception:  # noqa: BLE001 - a broken or encrypted PDF still goes on the board, without a page count
        return 0


def finish(db: Session, account: Account, space_id: int, received: Path, name: str) -> Stored:
    """The file at ``received`` (a temporary file in the media folder) becomes a media file, or is found as one.
    ``MediaError`` for a picture of more pixels than ``MAX_PIXELS``, counted before anything decodes it."""
    with open(received, "rb") as handle:
        kind = media.sniff(handle.read(64)) or "file"
    if kind in IMAGES | {"heic"} and _pixels(received, kind) > MAX_PIXELS:
        logger.info("Picture refused why=pixels by=%s", account.name)
        raise MediaError("too_many_pixels", "This picture has more pixels than nexcanvas takes.", 422)
    removed: set[str] = set()
    if kind in IMAGES | media.VIDEOS | {"heic"} and settings_service.get(db, "strip_location"):
        removed = media.strip(received, kind)
    name = clean_name(name)
    if kind == "heic":
        webp = received.with_name(received.name + ".webp")
        if media.to_webp(received, webp):
            os.replace(webp, received)
            kind = "webp"
            name = Path(name).stem + ".webp"
        else:
            webp.unlink(missing_ok=True)
    digest = _hash(received)
    existing = db.scalar(select(Media).where(Media.space_id == space_id, Media.sha256 == digest))
    if existing is not None and path_of(existing.id).is_file():
        received.unlink(missing_ok=True)
        return _stored(existing, sorted(removed), known=True)
    width, height = _picture_size(received) if kind in IMAGES else (0, 0)
    pages = _pdf_pages(received) if kind == "pdf" else 0
    media_id = secrets.token_urlsafe(12)
    size = received.stat().st_size
    row = Media(id=media_id, space_id=space_id, owner_id=account.id, name=name, kind=kind,
                mime=SHOWN.get(kind, "application/pdf" if kind == "pdf" else "application/octet-stream"),
                size=size, sha256=digest, width=width, height=height, pages=pages)
    # The row first: the clean-up removes files without one, and must never meet this one in between.
    db.add(row)
    db.commit()
    try:
        os.replace(received, path_of(media_id))
    except OSError:
        db.delete(row)
        db.commit()
        raise
    if kind in IMAGES and max(width, height) > PREVIEW_SIDE:
        _make_preview(path_of(media_id), preview_of(media_id))
    logger.info("Media stored id=%s kind=%s bytes=%s by=%s", media_id, kind, size, account.name)
    return _stored(row, sorted(removed), known=False)


def _stored(row: Media, removed: list[str], *, known: bool) -> Stored:
    return Stored(id=row.id, name=row.name, kind=row.kind, mime=row.mime, size=row.size, width=row.width,
                  height=row.height, pages=row.pages, removed=removed, known=known)

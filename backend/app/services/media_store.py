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
from . import media, settings_service

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


class MediaError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


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


def _pdf_pages(path: Path) -> int:
    try:
        from pypdf import PdfReader

        return len(PdfReader(path).pages)
    except Exception:  # noqa: BLE001 - a broken or encrypted PDF still goes on the board, without a page count
        return 0


def finish(db: Session, account: Account, space_id: int, received: Path, name: str) -> Stored:
    """The file at ``received`` (a temporary file in the media folder) becomes a media file, or is found as one."""
    with open(received, "rb") as handle:
        kind = media.sniff(handle.read(64)) or "file"
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
    logger.info("Media stored id=%s kind=%s bytes=%s by=%s", media_id, kind, size, account.name)
    return _stored(row, sorted(removed), known=False)


def _stored(row: Media, removed: list[str], *, known: bool) -> Stored:
    return Stored(id=row.id, name=row.name, kind=row.kind, mime=row.mime, size=row.size, width=row.width,
                  height=row.height, pages=row.pages, removed=removed, known=known)

"""Spaces: made by any account, which then manages it; renamed, coloured and deleted by their managers."""

from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import MANAGE, Account, Membership, Space, utcnow
from .names import CONTROL_TEXT, has_control

logger = logging.getLogger("nexcanvas.spaces")

#: The colours a space may have: the palette of the interface, nothing else.
COLORS = ("#ff8a70", "#fbbf24", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6", "#a1a1aa")
COLOR = re.compile(r"^#[0-9a-f]{6}$")
MAX_NAME = 80


class SpaceError(Exception):
    def __init__(self, code: str, text: str, status: int = 422) -> None:
        super().__init__(text)
        self.code = code
        self.text = text
        self.status = status


def clean_name(name: str) -> str:
    if has_control(name):
        raise SpaceError("invalid_characters", CONTROL_TEXT)
    text = " ".join(name.split())
    if not text or len(text) > MAX_NAME:
        raise SpaceError("invalid_name", "A space needs a name of 1 to 80 characters.")
    return text


def clean_color(color: str | None, fallback: str) -> str:
    if color is None:
        return fallback
    value = color.strip().lower()
    if not COLOR.match(value):
        raise SpaceError("invalid_color", "Not a colour nexcanvas offers.")
    return value


def create(db: Session, account: Account, name: str, color: str | None = None) -> Space:
    """A new space; the account that made it manages it."""
    taken = db.scalar(select(Space.id).where(Space.deleted_at.is_(None)).order_by(Space.id.desc()))
    fallback = COLORS[(taken or 0) % len(COLORS)]
    space = Space(name=clean_name(name), color=clean_color(color, fallback))
    db.add(space)
    db.flush()
    db.add(Membership(space_id=space.id, account_id=account.id, role=MANAGE))
    db.commit()
    logger.info("Space created id=%s by=%s", space.id, account.name)
    return space


def change(db: Session, space: Space, name: str | None, color: str | None) -> Space:
    if name is not None:
        space.name = clean_name(name)
    if color is not None:
        space.color = clean_color(color, space.color)
    db.commit()
    return space


def trash(db: Session, space: Space) -> None:
    """Into the bin with all its boards; the members stay, so a restore brings everything back as it was."""
    space.deleted_at = utcnow()
    db.commit()
    logger.info("Space moved to the trash id=%s", space.id)

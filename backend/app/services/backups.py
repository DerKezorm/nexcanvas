"""Backups of the whole of nexcanvas: the database and the photos and files of the boards, in one ZIP.

Built after nextrmnl's and nexlore's backup service:

* **The database is copied with SQLite's backup API**, never as a file: it runs in WAL mode, and a file copy misses
  what still sits in the ``-wal`` side file. The media files are copied after; they never change once written, so
  one added in between is at worst an extra file nobody points at.
* **The manifest lists every file with its size and sha256**, so the check before a restore can tell a damaged
  archive from a good one, and say what a restore would change.
* **Only automatic copies are pruned** (``scheduled`` and ``update``); one made by hand stays until deleted.
* **A restore happens at the next start.** ``stage_restore`` checks the archive, makes an ``update`` copy of the
  current state (the way back), unpacks into ``backups/restore-pending/`` and ends the process; Docker starts it
  again and ``apply_pending`` swaps the files before anything opens the database. A pending folder without its
  manifest is a half-written one and is thrown away, never applied.

The archive is not encrypted: it lies in the data folder next to the database it copies. Downloading it asks for
the operator's password once more.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import signal
import sqlite3
import threading
import time
import zipfile
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .. import __version__, private
from ..config import get_settings
from . import settings_service

logger = logging.getLogger("nexcanvas.backups")

FOLDER_NAME = "backups"
MANIFEST = "nexcanvas-backup.json"
DATABASE_ENTRY = "database/nexcanvas.db"
MEDIA_PREFIX = "media/"
#: The key the server encrypts its own secrets with (OIDC client secret, mail password): without it a restore on
#: another machine would bring those back unreadable. Whoever holds a backup holds the database anyway.
SECRET_ENTRY = "secret.key"
#: Media files are named by their id, a smaller copy of a photo by its id and ``.p`` (``services/media_store.py``).
MEDIA_NAME = re.compile(r"^[A-Za-z0-9_-]{8,40}(\.p)?$")
PENDING = "restore-pending"
MANUAL = "manual"
SCHEDULED = "scheduled"
UPDATE = "update"
AUTOMATIC_KINDS = (SCHEDULED, UPDATE)
SCHEDULES = ("off", "daily", "weekly")
INTERVALS = {"daily": 1, "weekly": 7}
NIGHT = range(3, 6)
CATCH_UP_DAYS = 1
INTERVAL_SECONDS = 3600
NAME = re.compile(r"^nexcanvas-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?\.zip$")
SQLITE_HEADER = b"SQLite format 3\x00"
_CHUNK = 1024 * 1024
_lock = threading.Lock()


class BackupError(Exception):
    def __init__(self, code: str, text: str) -> None:
        super().__init__(text)
        self.code = code
        self.text = text


@dataclass
class Manifest:
    version: str
    created: str
    kind: str
    note: str = ""
    boards: int = 0
    files: int = 0
    bytes: int = 0
    #: name in the media folder -> [size, sha256]
    media: dict[str, list[Any]] = field(default_factory=dict)


@dataclass
class Entry:
    name: str
    size: int
    created: str
    kind: str
    note: str
    boards: int
    files: int
    version: str


@dataclass
class Brief:
    """What a restore of an archive would do: its data, and how the media folder would change."""

    name: str
    version: str
    created: str
    kind: str
    boards: int
    files: int
    database_ok: bool
    files_ok: bool
    damaged: list[str]
    would_add: int
    would_change: int
    would_remove: int

    @property
    def usable(self) -> bool:
        return self.database_ok and self.files_ok


def folder() -> Path:
    return get_settings().data_dir / FOLDER_NAME


def pending_folder() -> Path:
    return folder() / PENDING


def media_root() -> Path:
    path = get_settings().media_dir
    assert path is not None
    return path


def path_of(name: str) -> Path:
    if not NAME.match(name):
        raise BackupError("not_found", "no such backup")
    path = folder() / name
    if not path.is_file():
        raise BackupError("not_found", "no such backup")
    return path


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%d-%H%M%S")


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _media_files(root: Path) -> list[tuple[str, Path]]:
    """Every media file, by name; nothing else that may lie there (temporary files of an upload, links)."""
    if not root.is_dir():
        return []
    return sorted(
        (entry.name, entry) for entry in root.iterdir()
        if MEDIA_NAME.match(entry.name) and entry.is_file() and not entry.is_symlink()
    )


def _database_copy(target: Path) -> int:
    """The database through SQLite's backup API. Returns how many boards it holds (not in the bin)."""
    source = sqlite3.connect(get_settings().database_path)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
        destination.execute("PRAGMA journal_mode=DELETE")
        destination.commit()
        try:
            row = destination.execute("SELECT count(*) FROM boards WHERE deleted_at IS NULL").fetchone()
        except sqlite3.DatabaseError:
            row = (0,)
        return int(row[0])
    finally:
        destination.close()
        source.close()


def create(*, kind: str = MANUAL, note: str = "") -> Path:
    """A new backup archive. Returns its path."""
    base = folder()
    base.mkdir(parents=True, exist_ok=True)
    private.tighten(base)
    moment = datetime.now(UTC)
    name = f"nexcanvas-{_stamp(moment)}.zip"
    number = 2
    while (base / name).exists():
        name = f"nexcanvas-{_stamp(moment)}-{number}.zip"
        number += 1
    partial = base / f".{name}.part"
    database = base / f".{name}.db"
    try:
        # Both only the owner's before a byte is in them: the archive holds the key and everything else.
        private.new_file(database)
        private.new_file(partial)
        boards = _database_copy(database)
        manifest = Manifest(version=__version__, created=moment.isoformat(timespec="seconds"), kind=kind, note=note,
                            boards=boards)
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.write(database, DATABASE_ENTRY)
            key = get_settings().data_dir / "secret.key"
            if key.is_file():
                archive.write(key, SECRET_ENTRY)
            for rel, full in _media_files(media_root()):
                try:
                    size = full.stat().st_size
                    # Photos and PDFs are packed already; deflating them again only costs time.
                    archive.write(full, MEDIA_PREFIX + rel, compress_type=zipfile.ZIP_STORED)
                    manifest.media[rel] = [size, _hash_file(full)]
                except OSError as exc:
                    logger.warning("A file could not be backed up and was left out: %s", exc.strerror)
                    continue
                manifest.files += 1
                manifest.bytes += size
            # Last: an archive without its manifest is recognisably incomplete.
            archive.writestr(MANIFEST, json.dumps(asdict(manifest), ensure_ascii=False))
        os.replace(partial, base / name)
    finally:
        partial.unlink(missing_ok=True)
        database.unlink(missing_ok=True)
    logger.info("Backup made kind=%s boards=%s files=%s bytes=%s", kind, manifest.boards, manifest.files,
                manifest.bytes)
    return base / name


def _manifest(archive: zipfile.ZipFile) -> Manifest:
    try:
        raw = json.loads(archive.read(MANIFEST).decode("utf-8"))
        return Manifest(**raw)
    except (KeyError, ValueError, TypeError) as exc:
        raise BackupError("backup_invalid", "the archive has no readable manifest") from exc


def entries() -> list[Entry]:
    base = folder()
    if not base.is_dir():
        return []
    found = []
    for path in base.iterdir():
        if not NAME.match(path.name):
            continue
        try:
            with zipfile.ZipFile(path) as archive:
                manifest = _manifest(archive)
        except (zipfile.BadZipFile, BackupError, OSError):
            continue
        found.append(
            Entry(path.name, path.stat().st_size, manifest.created, manifest.kind, manifest.note, manifest.boards,
                  manifest.files, manifest.version)
        )
    return sorted(found, key=lambda entry: entry.created, reverse=True)


def remove(name: str) -> None:
    path_of(name).unlink()
    logger.info("Backup deleted")


def prune(keep: int) -> int:
    automatic = [entry for entry in entries() if entry.kind in AUTOMATIC_KINDS]
    removed = 0
    for entry in automatic[max(keep, 1) :]:
        (folder() / entry.name).unlink(missing_ok=True)
        removed += 1
    if removed:
        logger.info("Old automatic backups removed count=%s", removed)
    return removed


# --- Checking and restoring -----------------------------------------------------------------------------------------


def _safe_member(name: str) -> str | None:
    """The media name of an archive member, or None when it is not a plain media file."""
    if not name.startswith(MEDIA_PREFIX):
        return None
    rel = name[len(MEDIA_PREFIX) :]
    return rel if MEDIA_NAME.match(rel) else None


def check(name: str) -> Brief:
    """The trial run: is the archive whole, and what would a restore change in the media folder?"""
    path = path_of(name)
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise BackupError("backup_invalid", "not a ZIP archive") from exc
    with archive:
        manifest = _manifest(archive)
        members = {info.filename: info for info in archive.infolist()}
        database_ok = False
        if DATABASE_ENTRY in members:
            scratch = folder() / f".check-{os.getpid()}-{time.time_ns()}.db"
            try:
                with archive.open(DATABASE_ENTRY) as source, open(scratch, "wb") as sink:
                    shutil.copyfileobj(source, sink, _CHUNK)
                if scratch.read_bytes()[:16] == SQLITE_HEADER:
                    connection = sqlite3.connect(scratch)
                    try:
                        database_ok = connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                    finally:
                        connection.close()
            except (sqlite3.DatabaseError, OSError):
                database_ok = False
            finally:
                scratch.unlink(missing_ok=True)
        damaged: list[str] = []
        for rel, (size, digest) in manifest.media.items():
            member = members.get(MEDIA_PREFIX + rel)
            if member is None or _safe_member(member.filename) != rel or member.file_size != size:
                damaged.append(rel)
                continue
            hasher = hashlib.sha256()
            with archive.open(member) as handle:
                while chunk := handle.read(_CHUNK):
                    hasher.update(chunk)
            if hasher.hexdigest() != digest:
                damaged.append(rel)
        damaged.extend(
            info.filename for info in archive.infolist()
            if not info.is_dir() and info.filename not in (MANIFEST, DATABASE_ENTRY, SECRET_ENTRY)
            and _safe_member(info.filename) not in manifest.media
        )
    current = dict(_media_files(media_root()))
    add = [rel for rel in manifest.media if rel not in current]
    remove_ = [rel for rel in current if rel not in manifest.media]
    change = [
        rel for rel, full in current.items()
        if rel in manifest.media
        and (full.stat().st_size != manifest.media[rel][0] or _hash_file(full) != manifest.media[rel][1])
    ]
    return Brief(
        name=name, version=manifest.version, created=manifest.created, kind=manifest.kind, boards=manifest.boards,
        files=manifest.files, database_ok=database_ok, files_ok=not damaged, damaged=sorted(damaged)[:20],
        would_add=len(add), would_change=len(change), would_remove=len(remove_),
    )


def stage_restore(name: str) -> Brief:
    """Check, keep the current state as a backup, and lay the archive out for the next start."""
    with _lock:
        brief = check(name)
        if not brief.usable:
            raise BackupError("backup_damaged", "the archive is damaged; nothing was changed")
        create(kind=UPDATE, note=f"before restoring {name}")
        pending = pending_folder()
        shutil.rmtree(pending, ignore_errors=True)
        pending.mkdir(parents=True)
        try:
            with zipfile.ZipFile(path_of(name)) as archive:
                manifest = _manifest(archive)
                with archive.open(DATABASE_ENTRY) as source, open(pending / "nexcanvas.db", "wb") as sink:
                    shutil.copyfileobj(source, sink, _CHUNK)
                if SECRET_ENTRY in archive.namelist():
                    (pending / "secret.key").write_bytes(archive.read(SECRET_ENTRY))
                (pending / "media").mkdir()
                for rel in manifest.media:
                    with archive.open(MEDIA_PREFIX + rel) as source, open(pending / "media" / rel, "wb") as sink:
                        shutil.copyfileobj(source, sink, _CHUNK)
                # Last: the manifest says the pending folder is complete.
                (pending / MANIFEST).write_bytes(json.dumps(asdict(manifest), ensure_ascii=False).encode())
        except BaseException:
            shutil.rmtree(pending, ignore_errors=True)
            raise
    logger.info("Backup staged for the next start created=%s", brief.created)
    return brief


def _end_restored_sessions(database: Path) -> None:
    """Sign-ins stored in the backup would come back to life, even ones ended since: everybody signs in anew."""
    connection = sqlite3.connect(database)
    try:
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").fetchone():
            connection.execute("DELETE FROM auth_sessions")
            connection.commit()
    finally:
        connection.close()


def restart_soon(delay: float = 1.5) -> None:
    """End the process shortly, after the answer went out; Docker starts it again (``restart: unless-stopped``)."""

    def stop() -> None:
        time.sleep(delay)
        logger.info("nexcanvas stops to restore a backup")
        if os.name == "nt":
            os._exit(3)
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except OSError:
            os._exit(0)
        time.sleep(10)
        os._exit(0)

    threading.Thread(target=stop, name="restart-for-restore", daemon=True).start()


def _remove_tree(folder_path: Path) -> None:
    """A folder and all in it, read-only files too (Windows refuses those to ``rmtree``); a few tries, because a
    virus scanner may still hold a file for a moment. What stays is tried again at the next start."""

    def writable_then_again(function: Any, path: str, _error: BaseException) -> None:
        try:
            os.chmod(path, 0o700)
            function(path)
        except OSError:
            pass

    for attempt in range(5):
        if not folder_path.exists():
            return
        shutil.rmtree(folder_path, onexc=writable_then_again)
        if not folder_path.exists():
            return
        time.sleep(0.2 * (attempt + 1))
    logger.warning("A folder set aside by a restore could not be removed yet: %s", folder_path.name)


def apply_pending() -> bool:
    """At the start, before anything opens the database: swap in a staged backup. Returns whether one was."""
    settings = get_settings()
    root = media_root()
    if root.parent.is_dir():
        for leftover in root.parent.glob(f"{root.name}.replaced-*"):
            if leftover.is_dir() and not leftover.is_symlink():
                _remove_tree(leftover)
    pending = pending_folder()
    if not pending.is_dir():
        return False
    if not (pending / MANIFEST).is_file() or not (pending / "nexcanvas.db").is_file():
        logger.warning("An incomplete restore was found and thrown away")
        shutil.rmtree(pending, ignore_errors=True)
        return False
    # The media folder belongs to nexcanvas alone: it is swapped as a whole, the old one set aside until the end.
    aside = root.with_name(f"{root.name}.replaced-{time.time_ns()}")
    moved = False
    try:
        if root.exists():
            os.rename(root, aside)
            moved = True
        incoming = pending / "media"
        if incoming.is_dir():
            shutil.move(str(incoming), str(root))
        else:
            root.mkdir(parents=True)
    except OSError:
        logger.exception("Restoring the media files failed, the previous state is put back")
        if moved and not root.exists():
            os.rename(aside, root)
        raise
    target = settings.database_path
    # Left behind, SQLite would read the old database's WAL into the restored one.
    for suffix in ("-wal", "-shm", "-journal"):
        target.with_name(target.name + suffix).unlink(missing_ok=True)
    shutil.copyfile(pending / "nexcanvas.db", target)
    _end_restored_sessions(target)
    if (pending / "secret.key").is_file():
        key = settings.data_dir / "secret.key"
        shutil.copyfile(pending / "secret.key", key)
        try:
            key.chmod(0o600)
        except OSError:
            pass
    manifest = json.loads((pending / MANIFEST).read_text(encoding="utf-8"))
    shutil.rmtree(pending, ignore_errors=True)
    if moved:
        _remove_tree(aside)
    logger.info("Backup restored created=%s files=%s", manifest.get("created"), manifest.get("files"))
    return True


# --- Schedule -------------------------------------------------------------------------------------------------------


def schedule(db: Any) -> str:
    value = settings_service.get(db, "backup_schedule")
    return value if value in SCHEDULES else "off"


def keep(db: Any) -> int:
    value = settings_service.get(db, "backup_keep")
    return value if isinstance(value, int) and 1 <= value <= 365 else 7


def due(every: str, *, now: datetime | None = None) -> bool:
    """Whether a scheduled copy is due: in the night, or a day late at any hour for a server that sleeps at night."""
    if every not in INTERVALS:
        return False
    moment = now or datetime.now().astimezone()
    last = next((entry for entry in entries() if entry.kind == SCHEDULED), None)
    if last is None:
        return moment.hour in NIGHT
    try:
        previous = datetime.fromisoformat(last.created)
    except ValueError:
        return True
    days = (moment - previous).total_seconds() / 86400
    interval = INTERVALS[every] - 0.25
    return days >= interval and (moment.hour in NIGHT or days >= interval + CATCH_UP_DAYS)


def run_job() -> None:
    from ..db import SessionLocal

    with _lock:
        with SessionLocal() as db:
            every = schedule(db)
            count = keep(db)
        for leftover in folder().glob(".*") if folder().is_dir() else []:
            if leftover.is_file() and time.time() - leftover.stat().st_mtime > 6 * 3600:
                leftover.unlink(missing_ok=True)
        if due(every):
            create(kind=SCHEDULED)
            prune(count)


async def run_forever(stop: asyncio.Event) -> None:
    """The hourly look, first an hour after the start."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=INTERVAL_SECONDS)
            return
        except TimeoutError:
            pass
        try:
            await asyncio.to_thread(run_job)
        except Exception:
            logger.exception("Backup job failed")

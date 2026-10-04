"""Working on a board together, live.

The browser speaks the y-websocket protocol (``y-protocols``): sync messages (step 1, step 2, update) and awareness
(who is here, where their pointer is). For every open board there is one room in this process: the document, the
connections and their rights.

* **Who may read follows along, who may write changes.** An update from a connection without the right to write is
  dropped, not applied; the browser of a reader never sends one, so a dropped update means a forged one.
* **Every update is stored before it is passed on**, so nothing anybody saw can be lost by a crash.
* **Session and rights are checked again** while a connection stays open, by a watcher of its own (a connection
  that only listens is checked too): every ``RECHECK_SECONDS``, and at once after a change that can take them
  (``nudge``: a session ended, an account blocked, a right or team changed, a sync with nexsuite). Signed out,
  blocked, deleted or taken out of the space, the connection is closed (Prüfgang 04.10.2026, A2/A3).
* **The room folds** the stored updates into the board every ``FOLD_AFTER`` updates and when the last one leaves.

One process serves the rooms; nexcanvas runs one worker (the database is SQLite anyway).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from pycrdt import (
    Doc,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    read_message,
)

from ..db import SessionLocal
from ..models import Account, Board
from . import boards, rights

logger = logging.getLogger("nexcanvas.live")

#: How often session and rights of an open connection are looked at again without a reason, in seconds.
RECHECK_SECONDS = 5
#: How often a watcher looks whether there is a reason (``nudge``), in seconds.
WATCH_TICK = 0.5
#: Close codes the browser understands: 4403 gone (right taken), 4413 too large, 4404 board gone.
CLOSE_FORBIDDEN = 4403
CLOSE_TOO_LARGE = 4413
CLOSE_GONE = 4404


class Socket(Protocol):
    async def send_bytes(self, data: bytes) -> None: ...

    async def close(self, code: int = 1000) -> None: ...


@dataclass(eq=False)
class Peer:
    socket: Socket
    account_id: int
    name: str
    can_write: bool
    #: The browser session the connection was opened with: when it ends, the connection ends.
    token: str = ""
    checked: float = field(default_factory=time.monotonic)
    #: The awareness client ids this connection announced, to say goodbye for them when it leaves.
    clients: set[int] = field(default_factory=set)
    #: Closed by its watcher: gets nothing more, sends nothing more.
    gone: bool = False


class Room:
    def __init__(self, board_id: str, doc: Doc) -> None:
        self.board_id = board_id
        self.doc = doc
        self.peers: set[Peer] = set()
        self.lock = asyncio.Lock()
        self.waiting = 0
        self.authors: set[str] = set()
        #: The last awareness message of every client, so a newcomer sees who is here at once.
        self.awareness: dict[int, bytes] = {}

    async def broadcast(self, data: bytes, skip: Peer | None = None) -> None:
        for peer in list(self.peers):
            if peer is skip or peer.gone:
                continue
            try:
                await peer.socket.send_bytes(data)
            except Exception:  # noqa: BLE001 - a connection that broke off fails in its server's own way
                self.peers.discard(peer)


_rooms: dict[str, Room] = {}
_rooms_guard = asyncio.Lock()
#: Counts the changes that can take a session or a right; every watcher looks again when it moved. Changed from the
#: request threads too: an int under the GIL is enough, a missed step only means the next timed check.
_epoch = 0


def nudge() -> None:
    """Something that can take a session or a right changed: every open connection is checked again at once."""
    global _epoch
    _epoch += 1


#: What can take a session or a right when it changes (``watch``).
_WATCHED_NAMES = ("Account", "AuthSession", "Membership", "Space", "Team", "TeamMember", "TeamGrant")


def watch(factory: Any) -> None:
    """Nudges the connections after every commit that touched an account, a session, a right, a space or a team.
    Bulk statements (``delete(...)``) pass by; who uses them for these calls ``nudge`` itself."""
    from sqlalchemy import event

    from .. import models

    watched = tuple(getattr(models, name) for name in _WATCHED_NAMES)

    @event.listens_for(factory, "after_flush")
    def _seen(session: Any, _context: Any) -> None:
        if any(isinstance(obj, watched) for obj in (*session.new, *session.dirty, *session.deleted)):
            session.info["live_nudge"] = True

    @event.listens_for(factory, "after_commit")
    def _done(session: Any) -> None:
        if session.info.pop("live_nudge", False):
            nudge()

    @event.listens_for(factory, "after_rollback")
    def _undone(session: Any) -> None:
        session.info.pop("live_nudge", None)


def forget() -> None:
    """For the tests: every room gone, and the guard made anew for the next event loop."""
    global _rooms_guard
    _rooms.clear()
    _rooms_guard = asyncio.Lock()


def room_of(board_id: str) -> Room | None:
    return _rooms.get(board_id)


async def _open_room(board_id: str) -> Room:
    async with _rooms_guard:
        room = _rooms.get(board_id)
        if room is None:
            with SessionLocal() as db:
                board = db.get(Board, board_id)
                assert board is not None
                doc = boards.load(db, board)
            room = Room(board_id, doc)
            _rooms[board_id] = room
        return room


async def _leave(room: Room, peer: Peer) -> None:
    room.peers.discard(peer)
    for client in peer.clients:
        # Tell the others this pointer is gone: the client's state as null, one clock further.
        last = room.awareness.pop(client, None)
        clock = _awareness_clock(last[1:], client) if last else 0
        await room.broadcast(_awareness_gone(client, clock + 1))
    if not room.peers:
        async with room.lock:
            if room.waiting:
                with SessionLocal() as db:
                    boards.fold(db, room.board_id, room.doc, room.authors)
                room.waiting = 0
                room.authors.clear()
        async with _rooms_guard:
            if not room.peers and _rooms.get(room.board_id) is room:
                del _rooms[room.board_id]


def _awareness_clients(message: bytes) -> list[int]:
    """The client ids an awareness update speaks for (``y-protocols/awareness``: count, then id, clock, state)."""
    from pycrdt import Decoder

    try:
        decoder = Decoder(read_message(message))
        count = decoder.read_var_uint()
        clients = []
        for _ in range(count):
            clients.append(decoder.read_var_uint())
            decoder.read_var_uint()
            decoder.read_var_string()
        return clients
    except Exception:  # noqa: BLE001 - a malformed awareness message names nobody
        return []


def _awareness_clock(message: bytes, wanted: int) -> int:
    from pycrdt import Decoder

    try:
        decoder = Decoder(read_message(message))
        for _ in range(decoder.read_var_uint()):
            client = decoder.read_var_uint()
            clock = decoder.read_var_uint()
            decoder.read_var_string()
            if client == wanted:
                return clock
    except Exception:  # noqa: BLE001, S110 - a malformed message: start the clock again
        pass
    return 0


def _awareness_gone(client: int, clock: int) -> bytes:
    from pycrdt import Encoder

    inner = Encoder()
    inner.write_var_uint(1)
    inner.write_var_uint(client)
    inner.write_var_uint(clock)
    inner.write_var_string("null")
    return bytes([YMessageType.AWARENESS]) + _with_length(inner.to_bytes())


def _allowed_now(peer: Peer, board_id: str) -> bool | None:
    """True: may write; False: may only read; None: may not even read (session ended, account blocked or gone,
    second factor required, out of the space, or the board went)."""
    from ..security import session_account
    from . import totp

    with SessionLocal() as db:
        account = session_account(db, peer.token)
        if account is None or account.id != peer.account_id or totp.setup_required(db, account):
            return None
        board = db.get(Board, board_id)
        if board is None or board.deleted_at is not None:
            return None
        role = rights.role_in(db, account, board.space_id)
    if not rights.at_least(role, rights.READ):
        return None
    return rights.at_least(role, rights.WRITE)


async def _still_allowed(peer: Peer, board_id: str) -> bool | None:
    return await asyncio.to_thread(_allowed_now, peer, board_id)


async def _watch(room: Room, peer: Peer, board_id: str) -> None:
    """Looks at the connection again on every nudge and every ``RECHECK_SECONDS``; closes it when it may not stay."""
    seen = _epoch
    while True:
        await asyncio.sleep(WATCH_TICK)
        if _epoch == seen and time.monotonic() - peer.checked < RECHECK_SECONDS:
            continue
        seen = _epoch
        peer.checked = time.monotonic()
        allowed = await _still_allowed(peer, board_id)
        if allowed is None:
            # Nothing more goes in or out from here, even before the browser sees the close.
            peer.can_write = False
            peer.gone = True
            room.peers.discard(peer)
            try:
                await peer.socket.close(CLOSE_FORBIDDEN)
            except Exception:  # noqa: BLE001, S110 - closed already
                pass
            return
        peer.can_write = allowed


async def serve(socket: Any, board_id: str, account: Account, can_write: bool, token: str) -> None:
    """One connection, from the first message to the last. ``socket`` is a Starlette WebSocket already accepted;
    ``token`` the browser session it came with."""
    room = await _open_room(board_id)
    peer = Peer(socket=socket, account_id=account.id, name=account.name, can_write=can_write, token=token)
    room.peers.add(peer)
    watcher = asyncio.create_task(_watch(room, peer, board_id))
    logger.debug("Joined board=%s name=%s write=%s peers=%s", board_id, account.name, can_write, len(room.peers))
    try:
        # The server opens with its own state vector, as y-websocket does; then everyone already here.
        async with room.lock:
            await socket.send_bytes(create_sync_message(room.doc))
        for data in list(room.awareness.values()):
            await socket.send_bytes(data)
        while True:
            message = await socket.receive_bytes()
            if peer.gone:
                return
            if not message:
                continue
            if message[0] == YMessageType.SYNC:
                await _on_sync(room, peer, message[1:])
            elif message[0] == YMessageType.AWARENESS:
                for client in _awareness_clients(message[1:]):
                    peer.clients.add(client)
                    room.awareness[client] = message
                await room.broadcast(message, skip=peer)
    except _TooLarge:
        await socket.close(CLOSE_TOO_LARGE)
    finally:
        watcher.cancel()
        await _leave(room, peer)
        logger.debug("Left board=%s name=%s peers=%s", board_id, account.name, len(room.peers))


class _TooLarge(Exception):
    pass


async def _on_sync(room: Room, peer: Peer, message: bytes) -> None:
    kind = message[0] if message else None
    if kind == YSyncMessageType.SYNC_STEP1:
        async with room.lock:
            update = room.doc.get_update(read_message(message[1:]))
        reply = bytes([YMessageType.SYNC]) + bytes([YSyncMessageType.SYNC_STEP2]) + _with_length(update)
        await peer.socket.send_bytes(reply)
        return
    if kind not in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
        return
    update = read_message(message[1:])
    if update == b"\x00\x00" or not peer.can_write:
        return
    if len(update) > boards.MAX_UPDATE:
        raise _TooLarge
    async with room.lock:
        before = room.doc.get_state()
        before_whole = room.doc.get_update()
        room.doc.apply_update(update)
        whole = room.doc.get_update()
        # Nothing new (the browser sent what the room had): neither stored nor passed on. The state vector alone does
        # not tell: a deletion leaves it as it was, only the whole document shows it.
        if room.doc.get_state() == before and whole == before_whole:
            return
        if len(whole) > boards.MAX_STATE:
            raise _TooLarge
        with SessionLocal() as db:
            room.waiting = boards.store_update(db, room.board_id, update, peer.name)
        room.authors.add(peer.name)
        if room.waiting >= boards.FOLD_AFTER:
            with SessionLocal() as db:
                boards.fold(db, room.board_id, room.doc, room.authors)
            room.waiting = 0
            room.authors.clear()
    await room.broadcast(create_update_message(update), skip=peer)


def _with_length(data: bytes) -> bytes:
    from pycrdt import write_var_uint

    return write_var_uint(len(data)) + data


async def push(board_id: str, update: bytes, by: str) -> None:
    """A change made by the server (a version brought back, an import): stored, and passed to everyone in the room."""
    room = room_of(board_id)
    if room is None:
        with SessionLocal() as db:
            boards.store_update(db, board_id, update, by)
            boards.fold_from_disk(db, board_id)
        return
    async with room.lock:
        room.doc.apply_update(update)
        with SessionLocal() as db:
            room.waiting = boards.store_update(db, board_id, update, by)
        room.authors.add(by)
    await room.broadcast(create_update_message(update))


async def close_board(board_id: str, code: int = CLOSE_GONE) -> None:
    """Everyone out of a board that went into the bin (or was deleted)."""
    room = room_of(board_id)
    if room is None:
        return
    for peer in list(room.peers):
        try:
            await peer.socket.close(code)
        except Exception:  # noqa: BLE001, S110 - closing one that is closed already
            pass


def picture(board_id: str) -> dict[str, Any] | None:
    """The live picture of an open board (newer than the stored one), or None when nobody has it open."""
    room = room_of(board_id)
    return boards.snapshot_of(room.doc) if room is not None else None

/**
 * The open board as a live Yjs document, shared with everyone who has it open.
 *
 * The editor keeps working with a plain picture (`Doc`: items in stacking order, lines), as it did before there was
 * a server: it reads `doc`, and hands every change back as a new picture (`commit` for one step, `live` while a drag
 * runs). This hook turns the difference between the pictures into changes of the shared document, and changes from
 * others into a new picture.
 *
 * The words of notes, shapes and texts are a shared Yjs text each (`texts`), so two people can type in the same note:
 * `setText` hands the edit over as an insertion and a deletion where the words differ, not as a new whole.
 *
 * The board's own background is a value in `meta`, the same for everybody; `setBackground` changes it as a step of
 * its own.
 *
 * Undo and redo are Yjs's own and only ever take back what this tab did, never another person's work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

import type { ShapeDef } from '../library/types'
import type { Background, Doc, Item, LineItem } from '../types'

export type LiveStatus = 'connecting' | 'live' | 'offline' | 'gone'

/** What a pointer of someone else looks like on the board. */
export interface Peer {
  client: number
  name: string
  color: string
  pointer?: { x: number; y: number }
  editing?: string | null
  selection?: string[]
}

const LOCAL = Symbol('local')
/** Items that carry words; they always have a text, empty or not. */
const WORDED = new Set(['note', 'shape', 'text'])
const EMPTY: Doc = { items: [], lines: [] }
/** Changes closer together than this are one step for undo (a drag, a word typed). */
const CAPTURE_MS = 600

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function picture(items: Y.Map<unknown>, lines: Y.Map<unknown>, texts: Y.Map<Y.Text>): Doc {
  const list: Item[] = []
  items.forEach((value, id) => {
    if (!value || typeof value !== 'object') return
    const text = texts.get(id)
    const item = { ...(value as object), id } as Item & { text?: string }
    if (text instanceof Y.Text) item.text = text.toString()
    else if (WORDED.has(item.kind) || ('text' in item && typeof item.text !== 'string')) item.text = ''
    list.push(item as Item)
  })
  list.sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0) || (a.id < b.id ? -1 : 1))
  const lineList: LineItem[] = []
  lines.forEach((value, id) => {
    if (value && typeof value === 'object') lineList.push({ ...(value as object), id } as LineItem)
  })
  return { items: list, lines: lineList }
}

/** Puts the difference between two words into a shared text: one deletion and one insertion at most. */
function diffInto(text: Y.Text, before: string, after: string): void {
  if (before === after) return
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  if (endBefore > start) text.delete(start, endBefore - start)
  if (endAfter > start) text.insert(start, after.slice(start, endAfter))
}

export function useLiveDoc(boardId: string, me: { name: string; color: string }) {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const items = useMemo(() => ydoc.getMap<unknown>('items'), [ydoc])
  const lines = useMemo(() => ydoc.getMap<unknown>('lines'), [ydoc])
  const texts = useMemo(() => ydoc.getMap<Y.Text>('texts'), [ydoc])
  const meta = useMemo(() => ydoc.getMap<unknown>('meta'), [ydoc])
  /** The shapes of packages the board uses, by `package/shape`: carried along so everybody can draw them. */
  const defMap = useMemo(() => ydoc.getMap<unknown>('defs'), [ydoc])
  const undoManager = useMemo(
    () => new Y.UndoManager([items, lines, texts, meta], { trackedOrigins: new Set([LOCAL]), captureTimeout: CAPTURE_MS }),
    [items, lines, texts, meta],
  )
  const [background, setShownBackground] = useState<Background | undefined>(undefined)
  const [defs, setDefs] = useState<Record<string, ShapeDef>>({})
  const shownDefs = useRef<Record<string, ShapeDef>>({})
  const [doc, setDoc] = useState<Doc>(EMPTY)
  const current = useRef<Doc>(EMPTY)
  const [status, setStatus] = useState<LiveStatus>('connecting')
  /** Why the server closed the board for good: 4403 no right (any more), 4404 in the bin, 4413 too large. */
  const [closed, setClosed] = useState<number | null>(null)
  const [synced, setSynced] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [history, setHistory] = useState({ undo: false, redo: false })
  const provider = useRef<WebsocketProvider | null>(null)

  // Others' changes and our own both arrive here; drawn once per frame at most.
  useEffect(() => {
    let frame = 0
    const redraw = () => {
      frame = 0
      const next = picture(items, lines, texts)
      current.current = next
      setDoc(next)
      const own = meta.get('background')
      setShownBackground(own && typeof own === 'object' ? (own as Background) : undefined)
      // A new object only when the board's shapes changed, so drawing everything again stays rare.
      if (defMap.size !== Object.keys(shownDefs.current).length) {
        const next: Record<string, ShapeDef> = {}
        defMap.forEach((value, key) => {
          if (value && typeof value === 'object') next[key] = value as ShapeDef
        })
        shownDefs.current = next
        setDefs(next)
      }
    }
    const changed = () => {
      if (!frame) frame = requestAnimationFrame(redraw)
    }
    ydoc.on('update', changed)
    const stacks = () => setHistory({ undo: undoManager.undoStack.length > 0, redo: undoManager.redoStack.length > 0 })
    undoManager.on('stack-item-added', stacks)
    undoManager.on('stack-item-popped', stacks)
    undoManager.on('stack-cleared', stacks)
    return () => {
      ydoc.off('update', changed)
      undoManager.off('stack-item-added', stacks)
      undoManager.off('stack-item-popped', stacks)
      undoManager.off('stack-cleared', stacks)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ydoc, items, lines, texts, meta, defMap, undoManager])

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const live = new WebsocketProvider(`${scheme}://${window.location.host}/api/boards`, `${boardId}/live`, ydoc, {
      maxBackoffTime: 5000,
    })
    provider.current = live
    live.awareness.setLocalStateField('user', me)
    live.on('status', ({ status: state }: { status: string }) => {
      if (state === 'connected') setStatus('live')
      else if (state === 'disconnected') setStatus((old) => (old === 'gone' ? old : 'offline'))
    })
    live.on('sync', (isSynced: boolean) => {
      if (isSynced) setSynced(true)
    })
    live.on('connection-close', (event: CloseEvent | null) => {
      // 4403: no right (any more), 4404: the board went into the bin, 4413: a change too large. No coming back.
      if (event && event.code >= 4400 && event.code < 4500) {
        setStatus('gone')
        setClosed(event.code)
        live.shouldConnect = false
        live.disconnect()
      }
    })
    const changedPeers = () => {
      const list: Peer[] = []
      live.awareness.getStates().forEach((state, client) => {
        if (client === ydoc.clientID || !state?.user) return
        list.push({ client, ...(state.user as { name: string; color: string }), pointer: state.pointer, editing: state.editing, selection: state.selection })
      })
      setPeers(list)
    }
    live.awareness.on('change', changedPeers)
    return () => {
      live.awareness.off('change', changedPeers)
      live.destroy()
      provider.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, ydoc])

  useEffect(() => () => ydoc.destroy(), [ydoc])

  /** Hands a new picture to the shared document: only what differs, in one transaction. */
  const apply = useCallback(
    (next: Doc) => {
      const before = current.current
      ydoc.transact(() => {
        const oldItems = new Map(before.items.map((item) => [item.id, item]))
        const keep = new Set<string>()
        let lastZ = -Infinity
        for (const item of next.items) {
          keep.add(item.id)
          const old = oldItems.get(item.id)
          const { text, ...rest } = item as Item & { text?: string }
          // The stacking order is the order of the list; a number only changes where the order would break.
          let z = Number(old?.z ?? rest.z)
          if (!Number.isFinite(z) || z <= lastZ) z = Number.isFinite(lastZ) ? lastZ + 1 : 0
          lastZ = z
          const value = { ...rest, z }
          delete (value as { id?: string }).id
          const stored = items.get(item.id)
          if (!stored || !sameJson(stored, value)) items.set(item.id, value)
          if (typeof text === 'string') {
            const shared = texts.get(item.id)
            if (shared instanceof Y.Text) diffInto(shared, shared.toString(), text)
            else texts.set(item.id, new Y.Text(text))
          }
        }
        for (const id of oldItems.keys()) {
          if (!keep.has(id)) {
            items.delete(id)
            texts.delete(id)
          }
        }
        // An item a stale picture forgot (added by someone else meanwhile) stays: only what this picture had goes.
        const oldLines = new Map(before.lines.map((line) => [line.id, line]))
        const keepLines = new Set<string>()
        for (const line of next.lines) {
          keepLines.add(line.id)
          const { id, ...value } = line
          const stored = lines.get(id)
          if (!stored || !sameJson(stored, value)) lines.set(id, value)
        }
        for (const id of oldLines.keys()) if (!keepLines.has(id)) lines.delete(id)
      }, LOCAL)
      current.current = picture(items, lines, texts)
      setDoc(current.current)
    },
    [ydoc, items, lines, texts],
  )

  const commit = useCallback(
    (update: (doc: Doc) => Doc) => {
      undoManager.stopCapturing()
      apply(update(current.current))
      undoManager.stopCapturing()
    },
    [apply, undoManager],
  )
  const live = useCallback((update: (doc: Doc) => Doc) => apply(update(current.current)), [apply])
  /** Measuring a text's height changes the board for everybody, but is no step of its own to undo. */
  const quiet = useCallback(
    (update: (doc: Doc) => Doc) => {
      const next = update(current.current)
      ydoc.transact(() => {
        for (const item of next.items) {
          const stored = items.get(item.id) as Record<string, unknown> | undefined
          if (stored && stored.h !== item.h) items.set(item.id, { ...stored, h: item.h })
        }
      }, 'measure')
      current.current = picture(items, lines, texts)
      setDoc(current.current)
    },
    [ydoc, items, lines, texts],
  )
  /** The board's own background for everybody; null goes back to the account's default. A step of its own. */
  const setBackground = useCallback(
    (next: Background | null) => {
      undoManager.stopCapturing()
      ydoc.transact(() => {
        if (next) meta.set('background', next)
        else meta.delete('background')
      }, LOCAL)
      undoManager.stopCapturing()
    },
    [ydoc, meta, undoManager],
  )
  /** Carries shapes of packages along with the board (once each; a shape already there stays as it was drawn). */
  const addDefs = useCallback(
    (more: Record<string, ShapeDef>) => {
      const missing = Object.entries(more).filter(([key]) => !defMap.has(key))
      if (!missing.length) return
      ydoc.transact(() => {
        for (const [key, def] of missing) defMap.set(key, def)
      }, 'defs')
    },
    [ydoc, defMap],
  )
  const checkpoint = useCallback(() => undoManager.stopCapturing(), [undoManager])
  const forget = useCallback(() => undefined, [])
  const undo = useCallback(() => {
    undoManager.undo()
  }, [undoManager])
  const redo = useCallback(() => {
    undoManager.redo()
  }, [undoManager])

  /** The words of one item, typed in place: shared character by character. */
  const setText = useCallback(
    (id: string, value: string) => {
      ydoc.transact(() => {
        const shared = texts.get(id)
        if (shared instanceof Y.Text) diffInto(shared, shared.toString(), value)
        else texts.set(id, new Y.Text(value))
      }, LOCAL)
    },
    [ydoc, texts],
  )

  const textOf = useCallback(
    (id: string) => {
      const shared = texts.get(id)
      return shared instanceof Y.Text ? shared.toString() : undefined
    },
    [texts],
  )

  const watchText = useCallback(
    (id: string, changed: () => void) => {
      const shared = texts.get(id)
      if (!(shared instanceof Y.Text)) return () => undefined
      const listener = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
        if (transaction.origin !== LOCAL) changed()
      }
      shared.observe(listener)
      return () => shared.unobserve(listener)
    },
    [texts],
  )

  /** Where this tab's pointer is and what it is doing, for the others. */
  const tell = useCallback((field: 'pointer' | 'editing' | 'selection', value: unknown) => {
    provider.current?.awareness.setLocalStateField(field, value)
  }, [])

  return {
    doc,
    background,
    setBackground,
    defs,
    addDefs,
    ref: current,
    commit,
    live,
    quiet,
    checkpoint,
    forget,
    undo,
    redo,
    canUndo: history.undo,
    canRedo: history.redo,
    setText,
    textOf,
    watchText,
    tell,
    status,
    closed,
    synced,
    peers,
  }
}

export type LiveDoc = ReturnType<typeof useLiveDoc>

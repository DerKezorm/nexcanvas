import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FileDown, FileUp, History, ImageDown, Keyboard, Maximize, Minus, MoreHorizontal, Plus, Presentation, Redo2, RotateCw, Share2, Star, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ContextBar, type ContextActions } from '../board/canvas/ContextBar'
import { ExportDialog } from '../board/canvas/ExportDialog'
import { ScenesPanel } from '../board/canvas/ScenesPanel'
import { ItemView } from '../board/canvas/ItemView'
import { ItemActions } from '../board/canvas/PdfPage'
import { Lines } from '../board/canvas/Lines'
import { ShareDialog } from '../board/canvas/ShareDialog'
import { ShortcutsDialog } from '../board/canvas/ShortcutsDialog'
import { Toolbar, type Tool, type ToolState } from '../board/canvas/Toolbar'
import { useLiveDoc } from '../board/canvas/useLiveDoc'
import { VersionsDialog } from '../board/canvas/VersionsDialog'
import { Peers, PeerPointers, personColor } from '../board/canvas/Peers'
import { bounds, center, contains, intersects, lineGeometry, normalize, outer, toBoard, toScreen, turn, type Point, type Rect } from '../board/geometry'
import { outline } from '../board/ink'
import { drawOrder, waitingInk } from '../board/order'
import { arrange } from '../board/arrange'
import { NOTE_COLORS, paint } from '../board/palette'
import { toBoard as boardFromInfo, useBoards } from '../board/store'
import type { Board, Doc, End, FrameItem, InkItem, Item, LineItem, View } from '../board/types'
import { ApiError, boardsApi, mediaApi } from '../api/client'
import { errorText } from '../lib/errors'
import { useAuth } from '../state/auth'
import { Dialog } from '../components/Dialog'
import { Popover } from '../components/Popover'

const uid = () => Math.random().toString(36).slice(2, 10)

/** The ids given, and every item that shares a group with one of them: a group is picked as one. */
function withGroups(ids: string[], items: Item[]): string[] {
  const groups = new Set(items.filter((i) => i.group && ids.includes(i.id)).map((i) => i.group))
  if (groups.size === 0) return ids
  return [...new Set([...ids, ...items.filter((i) => i.group && groups.has(i.group)).map((i) => i.id)])]
}

/** What lies in a frame: everything whose middle is inside it. Moving the frame moves these along. */
function inFrame(frame: Item, items: Item[]): Item[] {
  return items.filter((i) => i.id !== frame.id && !(i.kind === 'frame' && i.w * i.h >= frame.w * frame.h) && contains(frame, center(i)))
}

/** Frames in reading order: rows from top to bottom, in a row from left to right. Presenting goes this way. */
function framesInOrder(items: Item[]): FrameItem[] {
  const frames = items.filter((i): i is FrameItem => i.kind === 'frame')
  return frames.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x))
}

/** The drawings that belong to the given PDFs, on every page. */
function notesOn(ids: Set<string>, items: Item[]): string[] {
  return items.filter((i) => i.kind === 'ink' && i.on && ids.has(i.on.item)).map((i) => i.id)
}

/** Outlines without a photo in them (the slots of a mood board), the one under `at` first and the others by how
 * near they are; none at all when `at` is on no empty outline, so a photo dropped elsewhere keeps its own size. */
function emptySlots(items: Item[], at: Point): Item[] {
  const photos = items.filter((i) => i.kind === 'image').map(center)
  const empty = items.filter((i) => i.kind === 'shape' && i.fill === 'none' && !i.locked && i.w > 40 && i.h > 40 && !photos.some((p) => contains(i, p)))
  const first = [...empty].reverse().find((i) => contains(i, at))
  if (!first) return []
  const far = (i: Item) => Math.hypot(center(i).x - center(first).x, center(i).y - center(first).y)
  return [first, ...empty.filter((i) => i !== first).sort((a, b) => far(a) - far(b))]
}

/** Gives copied items new group ids, so a copy of a group is a group of its own and not part of the first. */
function freshGroups<T extends Item>(copies: T[]): T[] {
  const map = new Map<string, string>()
  return copies.map((c) => {
    if (!c.group) return c
    if (!map.has(c.group)) map.set(c.group, uid())
    return { ...c, group: map.get(c.group) }
  })
}
const LONG_PRESS_MS = 500
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Side = 'top' | 'right' | 'bottom' | 'left'

type Gesture =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'move'; start: Point; ids: string[]; lines: string[]; origin: Doc; moved: boolean; box: Rect }
  | { kind: 'resize'; handle: Handle; start: Point; origin: Doc; box: Rect; ids: string[]; keep: boolean; moved: boolean }
  // `origin` is the picture when the gesture began: where things were. The live picture is changed from it only for
  // what the gesture moves, so a note somebody else adds or edits meanwhile stays as it is.
  | { kind: 'marquee'; start: Point; add: string[] }
  | { kind: 'create'; tool: 'note' | 'shape' | 'text' | 'frame'; start: Point }
  | { kind: 'rotate'; ids: string[]; middle: Point; from: number; origin: Doc; moved: boolean }
  | { kind: 'draw'; points: number[][] }
  | { kind: 'erase'; hit: boolean }
  | { kind: 'line'; a: End; from?: string; side?: Side; startScreen: Point }
  | { kind: 'end'; line: string; which: 'a' | 'b'; moved: boolean }
  | { kind: 'pinch' }

export function BoardPage() {
  const { id = '' } = useParams()
  const boards = useBoards()
  const known = boards.board(id)
  const { t } = useTranslation()
  // Opened by a link before the overview loaded (or a board from a space just joined): asked for on its own.
  // Kept with the id it belongs to: after going to another board, the one fetched before must never stand in for it.
  const [answer, setAnswer] = useState<{ id: string; board: Board | 'missing' } | null>(null)
  useEffect(() => {
    if (known) return
    let cancelled = false
    boardsApi.read(id).then(
      (info) => !cancelled && setAnswer({ id, board: boardFromInfo(info) }),
      () => !cancelled && setAnswer({ id, board: 'missing' }),
    )
    return () => {
      cancelled = true
    }
  }, [id, known])
  const fetched = answer?.id === id ? answer.board : null
  const board = known ?? (fetched && fetched !== 'missing' ? fetched : undefined)
  if (!board && fetched !== 'missing') return <main className="nc-board flex-1" />
  if (!board || board.deleted) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="text-mist-400">{t('board.missing')}</p>
          <Link to="/" className="mt-3 inline-block text-accent-400 hover:underline">
            {t('board.back')}
          </Link>
        </div>
      </main>
    )
  }
  return <Editor key={board.id} board={board} />
}

function Editor({ board }: { board: Board }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const boards = useBoards()
  const { me } = useAuth()
  const space = boards.space(board.space)
  const shownName = me?.display_name || me?.name || '?'
  const prefs = { snap: me?.preferences?.snap ?? true, dots: me?.preferences?.dots ?? true, tool_back: me?.preferences?.tool_back ?? true }
  const doc = useLiveDoc(board.id, { name: shownName, color: personColor(me?.name ?? '') })
  const readOnly = board.role === 'read' || space?.role === 'read' || doc.status === 'gone'
  const { items, lines } = doc.doc
  const [notice, setNotice] = useState<string | null>(null)
  const [uploads, setUploads] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1200, h: 800 })
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [tools, setTools] = useState<ToolState>({ tool: 'select', shape: 'round', note: 'yellow', pen: 'auto', penSize: 3 })
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<{ ink?: number[][]; rect?: Rect; line?: { a: Point; b: Point; target?: string } } | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [share, setShare] = useState(false)
  const [versions, setVersions] = useState(false)
  const [scenes, setScenes] = useState(false)
  /** The frame shown while presenting, as its place in reading order. */
  const [presenting, setPresenting] = useState<number | null>(null)
  const [exporting, setExporting] = useState<'board' | 'selection' | null>(null)
  const [keys, setKeys] = useState(false)
  const [asking, setAsking] = useState<'link' | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; at: Point; on: string | null } | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ dist: number; mid: Point; view: View } | null>(null)
  const press = useRef<{ timer: number; at: Point }>({ timer: 0, at: { x: 0, y: 0 } })
  /** A long press opened the menu: the finger's lifting ends nothing else. */
  const pressed = useRef(false)
  const lastTap = useRef({ time: 0, x: 0, y: 0, handled: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const canvasInput = useRef<HTMLInputElement>(null)
  const lastTold = useRef(0)
  const clipboard = useRef<Doc | null>(null)
  const freshText = useRef<string | null>(null)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const waiting = useMemo(() => waitingInk(items), [items])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selItems = items.filter((i) => selectedSet.has(i.id))
  const selLines = lines.filter((l) => selectedSet.has(l.id))

  // Opening counts as a visit; the overview sorts "recent" by it.
  useEffect(() => {
    void boardsApi.visit(board.id).catch(() => undefined)
  }, [board.id])

  // What this tab does, for the others: what it has selected and where it writes.
  useEffect(() => doc.tell('selection', selected), [doc, selected])
  useEffect(() => doc.tell('editing', editing), [doc, editing])

  // A notice at the bottom goes by itself after a while.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // The size of the board area, for fitting and for placing things in the middle.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(
    (rect: Rect | null = bounds(doc.ref.current.items), animate = true, wanted = 90) => {
      const el = root.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      const pad = w < 640 ? Math.min(wanted, 20) : wanted
      if (!rect) {
        setView({ x: w / 2, y: h / 2, zoom: 1 })
        return
      }
      // Room for the tool bar at the top, except when presenting (a small margin, nothing over the frame). A phone has
      // its tools at the bottom and little room to give away: a narrow margin there.
      const onStage = wanted < 90
      const bar = !onStage && w >= 640 ? 40 : 0
      const zoom = clampZoom(Math.min((w - pad * 2) / Math.max(rect.w, 1), (h - pad * 2 - bar) / Math.max(rect.h, 1), onStage ? MAX_ZOOM : 1.4))
      const next = { zoom, x: w / 2 - (rect.x + rect.w / 2) * zoom, y: h / 2 + bar / 2 - (rect.y + rect.h / 2) * zoom }
      if (!animate) return setView(next)
      const from = viewRef.current
      const start = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 260)
        const e = 1 - Math.pow(1 - k, 3)
        setView({ x: from.x + (next.x - from.x) * e, y: from.y + (next.y - from.y) * e, zoom: from.zoom + (next.zoom - from.zoom) * e })
        if (k < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    },
    [doc.ref],
  )

  // The whole board in view once it arrived from the server (not before: an empty board would fit to nothing).
  const fitted = useRef(false)
  useEffect(() => {
    if (!doc.synced || fitted.current) return
    fitted.current = true
    fit(undefined, false)
  }, [doc.synced, fit])

  const local = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = root.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])

  const zoomAt = useCallback((screen: Point, factor: number) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor)
      const k = zoom / v.zoom
      return { zoom, x: screen.x - (screen.x - v.x) * k, y: screen.y - (screen.y - v.y) * k }
    })
  }, [])

  // Wheel: pan, with Ctrl (and trackpad pinch) zoom around the pointer. Not passive, so the page does not scroll.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      // A mouse wheel notch is about 100, a trackpad pinch sends small steps; both should feel alike.
      if (e.ctrlKey || e.metaKey) zoomAt(local(e), Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * (Math.abs(e.deltaY) < 40 ? 0.01 : 0.0035)))
      else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [local, zoomAt])

  const itemAt = useCallback(
    (p: Point, skip?: string): string | undefined => {
      const list = doc.ref.current.items
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i]
        if (it.id === skip || it.kind === 'ink') continue
        if (contains(it, p)) return it.id
      }
      return undefined
    },
    [doc.ref],
  )

  const setTool = useCallback((tool: Tool) => {
    setTools((s) => ({ ...s, tool }))
    setEditing(null)
  }, [])

  const middle = useCallback((): Point => toBoard({ x: size.w / 2, y: size.h / 2 }, viewRef.current), [size])

  const add = useCallback(
    (item: Item, edit = false) => {
      doc.commit((d) => ({ ...d, items: [...d.items, item] }))
      setSelected([item.id])
      if (edit) {
        setEditing(item.id)
        freshText.current = item.id
      }
    },
    [doc],
  )

  const removeIds = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids)
      for (const id of notesOn(gone, doc.ref.current.items)) gone.add(id)
      doc.commit((d) => ({
        items: d.items.filter((i) => !gone.has(i.id)),
        lines: d.lines.filter((l) => !gone.has(l.id) && !(l.a.item && gone.has(l.a.item)) && !(l.b.item && gone.has(l.b.item))),
      }))
      setSelected([])
    },
    [doc],
  )

  const duplicate = useCallback(
    (ids: string[], offset = 24) => {
      const d = doc.ref.current
      const map = new Map<string, string>()
      const copies = d.items.filter((i) => ids.includes(i.id)).map((i) => {
        const id = uid()
        map.set(i.id, id)
        return { ...i, id, x: i.x + offset, y: i.y + offset, locked: false }
      })
      const regrouped = freshGroups(copies)
      const lineCopies = d.lines
        .filter((l) => (l.a.item ? map.has(l.a.item) : false) && (l.b.item ? map.has(l.b.item) : false))
        .map((l) => ({ ...l, id: uid(), a: { ...l.a, item: map.get(l.a.item!) }, b: { ...l.b, item: map.get(l.b.item!) } }))
      doc.commit((x) => ({ items: [...x.items, ...regrouped], lines: [...x.lines, ...lineCopies] }))
      setSelected([...regrouped.map((c) => c.id), ...lineCopies.map((l) => l.id)])
    },
    [doc],
  )

  /** Two or more items become one group (groups among them melt into it); lines are never part of one. */
  const group = useCallback(
    (ids: string[]) => {
      const chosen = new Set(ids)
      if (doc.ref.current.items.filter((i) => chosen.has(i.id)).length < 2) return
      const id = uid()
      doc.commit((d) => ({ ...d, items: d.items.map((i) => (chosen.has(i.id) ? { ...i, group: id } : i)) }))
    },
    [doc],
  )

  const ungroup = useCallback(
    (ids: string[]) => {
      const chosen = new Set(ids)
      doc.commit((d) => ({ ...d, items: d.items.map((i) => (chosen.has(i.id) && i.group ? { ...i, group: undefined } : i)) }))
    },
    [doc],
  )

  /** Photos and files go to the server first; the board gets an item that names them by id. */
  const addFiles = useCallback(
    (files: File[], at: Point) => {
      // Photos dropped on an empty outline (a mood board's slots) fill it, and the next ones the nearest empty ones.
      const slots = emptySlots(doc.ref.current.items, at)
      let slotFor = 0
      files.forEach(async (file, n) => {
        const spot = { x: at.x + n * 30, y: at.y + n * 30 }
        const likelyPicture = file.type.startsWith('image/')
        const slot = likelyPicture ? slots[slotFor] : undefined
        if (slot) slotFor++
        setUploads((count) => count + 1)
        try {
          const stored = await mediaApi.upload(board.space, file, file.name || 'file')
          const isPicture = ['jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(stored.kind) && stored.width > 0
          if (isPicture) {
            const scale = Math.min(1, 420 / Math.max(stored.width, stored.height))
            const w = Math.max(60, stored.width * scale)
            const h = Math.max(60, stored.height * scale)
            const preview = stored.width > 1600 || stored.height > 1600
            if (slot) add({ id: uid(), kind: 'image', x: slot.x + 6, y: slot.y + 6, w: slot.w - 12, h: slot.h - 12, media: stored.id, preview, ...(slot.rot ? { rot: slot.rot } : {}) })
            else add({ id: uid(), kind: 'image', x: spot.x - w / 2, y: spot.y - h / 2, w, h, media: stored.id, preview })
          } else {
            const ext = stored.kind === 'file' ? (stored.name.split('.').pop() ?? 'file').toLowerCase().slice(0, 5) : stored.kind
            const kb = stored.size / 1024
            const sizeLabel = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`
            const pdf = stored.kind === 'pdf'
            add({ id: uid(), kind: 'file', x: spot.x - 95, y: spot.y - 115, w: pdf ? 300 : 190, h: pdf ? 400 : 230, media: stored.id, name: stored.name, ext, sizeLabel, pages: stored.pages || undefined, page: pdf ? 1 : undefined })
          }
          if (stored.removed.includes('location') || stored.removed.includes('device')) setNotice(t('media.cleaned'))
          if (stored.removed.includes('unchecked')) setNotice(t('media.unchecked'))
        } catch (error) {
          const code = error instanceof ApiError ? error.code : 'internal_error'
          setNotice(errorText(code, error instanceof ApiError ? error.values : {}))
        } finally {
          setUploads((count) => count - 1)
        }
      })
    },
    [add, board.space, t, doc.ref],
  )

  /** A JSON Canvas from nexlore, Obsidian or another nexcanvas, onto the middle of what is in view. */
  const importCanvas = async (file: File) => {
    setUploads((count) => count + 1)
    try {
      const result = await boardsApi.importCanvas(board.id, file, middle())
      let text = t('canvasFile.imported', { count: result.items })
      if (result.missing.length) text += ' ' + t('canvasFile.missing', { count: result.missing.length })
      setNotice(text)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'internal_error'
      setNotice(errorText(code, error instanceof ApiError ? error.values : {}))
    } finally {
      setUploads((count) => count - 1)
    }
  }

  const addLink = useCallback(
    (url: string, at: Point) => {
      let site = url
      let path = ''
      try {
        const u = new URL(/^https?:/i.test(url) ? url : 'https://' + url)
        site = u.hostname
        path = decodeURIComponent(u.pathname).replace(/[-_/]+/g, ' ').trim()
        url = u.toString()
      } catch {
        // Then the words stay as they were typed.
      }
      let hue = 0
      for (const ch of site) hue = (hue * 31 + ch.charCodeAt(0)) % 360
      add({ id: uid(), kind: 'link', x: at.x - 115, y: at.y - 95, w: 230, h: 190, url, site, title: path ? path.charAt(0).toUpperCase() + path.slice(1) : site, hue })
    },
    [add],
  )

  // ---------- pointer ----------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (menu) setMenu(null)
    const target = e.target as HTMLElement
    if (target.closest('[data-ui]') || presenting !== null) return
    const s = local(e)
    pointers.current.set(e.pointerId, s)
    root.current?.setPointerCapture(e.pointerId)
    clearTimeout(press.current.timer)
    if (e.pointerType === 'touch' && pointers.current.size === 1) {
      const at = { clientX: e.clientX, clientY: e.clientY }
      press.current = {
        at: s,
        timer: window.setTimeout(() => {
          // Held still: whatever the finger began (a move, a pan) gives way to the menu.
          gesture.current = null
          setDraft(null)
          setMarquee(null)
          pressed.current = true
          menuAt(at)
        }, LONG_PRESS_MS),
      }
    }

    // Two fingers: zoom and pan, whatever was going on.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current }
      gesture.current = { kind: 'pinch' }
      setDraft(null)
      setMarquee(null)
      return
    }
    if (e.button === 2) return
    const p = toBoard(s, viewRef.current)
    const tool = tools.tool

    if (e.button === 1 || tool === 'hand' || spaceHeld) {
      gesture.current = { kind: 'pan', start: s, view: viewRef.current }
      return
    }
    if (editing) setEditing(null)
    if (readOnly) {
      gesture.current = { kind: 'pan', start: s, view: viewRef.current }
      return
    }

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset
    if (handle?.handle === 'resize') {
      const own = selItems.filter((i) => !i.locked).map((i) => i.id)
      // A PDF's notes grow and shrink with it.
      const ids = [...own, ...notesOn(new Set(own), doc.ref.current.items).filter((id) => !own.includes(id))]
      const box = bounds(selItems.filter((i) => !i.locked))
      if (box && ids.length) {
        const keep = e.shiftKey || selItems.some((i) => i.kind === 'image' || i.kind === 'ink') || ids.length > 1
        gesture.current = { kind: 'resize', handle: handle.dir as Handle, start: p, origin: doc.ref.current, box, ids, keep: keep && (handle.dir?.length ?? 0) === 2, moved: false }
      }
      return
    }
    if (handle?.handle === 'rotate') {
      const turning = selItems.filter((i) => !i.locked && i.kind !== 'frame')
      const box = bounds(turning)
      if (box && turning.length) {
        const middle = turning.length === 1 ? center(turning[0]) : center(box)
        gesture.current = { kind: 'rotate', ids: turning.map((i) => i.id), middle, from: Math.atan2(p.y - middle.y, p.x - middle.x), origin: doc.ref.current, moved: false }
      }
      return
    }
    if (handle?.handle === 'connect') {
      gesture.current = { kind: 'line', a: { item: handle.for, x: p.x, y: p.y }, from: handle.for, side: handle.side as Side, startScreen: s }
      return
    }
    if (handle?.handle === 'end') {
      doc.checkpoint()
      gesture.current = { kind: 'end', line: handle.line!, which: handle.which as 'a' | 'b', moved: false }
      return
    }

    const itemId = target.closest<HTMLElement>('[data-item]')?.dataset.item
    const lineId = target.closest<SVGElement>('[data-line]')?.dataset.line

    if (tool === 'select') {
      const hit = itemId ?? lineId
      if (hit) {
        const all = doc.ref.current.items
        const picked = withGroups([hit], all)
        let next = selected
        if (e.shiftKey) next = selectedSet.has(hit) ? selected.filter((x) => !picked.includes(x)) : [...new Set([...selected, ...picked])]
        else if (!selectedSet.has(hit)) next = picked
        setSelected(next)
        const chosen = new Set(next)
        // A frame takes along what lies in it, and the free ends of lines in it.
        const frames = all.filter((i) => chosen.has(i.id) && i.kind === 'frame' && !i.locked)
        for (const frame of frames) for (const inside of inFrame(frame, all)) chosen.add(inside.id)
        for (const id of notesOn(chosen, all)) chosen.add(id)
        const movable = all.filter((i) => chosen.has(i.id) && !i.locked)
        const freeLines = doc.ref.current.lines
          .filter((l) => chosen.has(l.id) || frames.some((f) => (!l.a.item && contains(f, l.a)) || (!l.b.item && contains(f, l.b))))
          .map((l) => l.id)
        const box = bounds(movable) ?? { x: p.x, y: p.y, w: 0, h: 0 }
        gesture.current = { kind: 'move', start: p, ids: movable.map((i) => i.id), lines: freeLines, origin: doc.ref.current, moved: false, box }
      } else {
        if (!e.shiftKey) setSelected([])
        gesture.current = e.pointerType === 'touch' ? { kind: 'pan', start: s, view: viewRef.current } : { kind: 'marquee', start: p, add: e.shiftKey ? selected : [] }
      }
      return
    }
    if (tool === 'note' || tool === 'shape' || tool === 'text' || tool === 'frame') {
      gesture.current = { kind: 'create', tool, start: p }
      return
    }
    if (tool === 'pen' || tool === 'marker') {
      const pts = [[p.x, p.y, e.pressure || 0.5]]
      gesture.current = { kind: 'draw', points: pts }
      setDraft({ ink: pts })
      return
    }
    if (tool === 'eraser') {
      gesture.current = { kind: 'erase', hit: false }
      erase(target)
      return
    }
    if (tool === 'line') {
      const on = itemAt(p)
      gesture.current = { kind: 'line', a: { item: on, x: p.x, y: p.y }, from: on, startScreen: s }
    }
  }

  const erase = (target: Element | null) => {
    const g = gesture.current
    if (!g || g.kind !== 'erase') return
    const id = (target as HTMLElement | null)?.closest<HTMLElement>('[data-item]')?.dataset.item
    const item = id ? doc.ref.current.items.find((i) => i.id === id) : undefined
    if (item?.kind === 'ink') {
      if (!g.hit) doc.checkpoint()
      g.hit = true
      doc.live((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }))
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = local(e)
    if (press.current.timer && Math.hypot(s.x - press.current.at.x, s.y - press.current.at.y) > 8) clearTimeout(press.current.timer)
    // The others see this pointer, a few times a second at most.
    // eslint-disable-next-line react-hooks/purity -- an event handler, not part of drawing
    const now = performance.now()
    if (now - lastTold.current > 50) {
      lastTold.current = now
      doc.tell('pointer', toBoard(s, viewRef.current))
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s)
    const g = gesture.current
    if (!g) return
    const v = viewRef.current
    const p = toBoard(s, v)

    switch (g.kind) {
      case 'pinch': {
        if (pointers.current.size < 2 || !pinch.current) return
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const start = pinch.current
        const zoom = clampZoom(start.view.zoom * (dist / start.dist))
        const anchor = toBoard(start.mid, start.view)
        setView({ zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom })
        return
      }
      case 'pan':
        setView({ ...g.view, x: g.view.x + s.x - g.start.x, y: g.view.y + s.y - g.start.y })
        return
      case 'move': {
        let dx = p.x - g.start.x
        let dy = p.y - g.start.y
        if (!g.moved && Math.hypot(dx * v.zoom, dy * v.zoom) < 3) return
        if (!g.moved) {
          doc.checkpoint()
          g.moved = true
        }
        // Snap the edges and middles of what moves to those of the other items, unless Alt is held.
        const gx: number[] = []
        const gy: number[] = []
        if ((prefs.snap !== e.altKey) && g.ids.length) {
          const tol = 6 / v.zoom
          const moving = { x: g.box.x + dx, y: g.box.y + dy, w: g.box.w, h: g.box.h }
          const others = g.origin.items.filter((i) => !g.ids.includes(i.id) && i.kind !== 'ink')
          let bestX: number | null = null
          let bestY: number | null = null
          for (const o of others) {
            for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
              for (const mx of [moving.x, moving.x + moving.w / 2, moving.x + moving.w]) {
                const d = ox - mx
                if (Math.abs(d) < tol && (bestX === null || Math.abs(d) < Math.abs(bestX))) {
                  bestX = d
                  gx.length = 0
                  gx.push(ox)
                }
              }
            }
            for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
              for (const my of [moving.y, moving.y + moving.h / 2, moving.y + moving.h]) {
                const d = oy - my
                if (Math.abs(d) < tol && (bestY === null || Math.abs(d) < Math.abs(bestY))) {
                  bestY = d
                  gy.length = 0
                  gy.push(oy)
                }
              }
            }
          }
          if (bestX !== null) dx += bestX
          if (bestY !== null) dy += bestY
        }
        setGuides({ x: gx, y: gy })
        const ids = new Set(g.ids)
        const lineIds = new Set(g.lines)
        const startItems = new Map(g.origin.items.map((i) => [i.id, i]))
        const startLines = new Map(g.origin.lines.map((l) => [l.id, l]))
        doc.live((d) => ({
          items: d.items.map((i) => {
            const from = ids.has(i.id) ? startItems.get(i.id) : undefined
            return from ? { ...i, x: from.x + dx, y: from.y + dy } : i
          }),
          lines: d.lines.map((l) => {
            const from = lineIds.has(l.id) ? startLines.get(l.id) : undefined
            return from ? { ...l, a: l.a.item ? l.a : { x: from.a.x + dx, y: from.a.y + dy }, b: l.b.item ? l.b : { x: from.b.x + dx, y: from.b.y + dy } } : l
          }),
        }))
        return
      }
      case 'rotate': {
        let delta = ((Math.atan2(p.y - g.middle.y, p.x - g.middle.x) - g.from) * 180) / Math.PI
        if (!g.moved) {
          if (Math.abs(delta) < 1) return
          doc.checkpoint()
          g.moved = true
        }
        const startItems = new Map(g.origin.items.map((i) => [i.id, i]))
        const first = startItems.get(g.ids[0])
        // Shift turns in steps of 15 degrees; near a right angle it settles there by itself.
        const settle = (deg: number) => {
          if (e.shiftKey) return Math.round(deg / 15) * 15
          const right = Math.round(deg / 90) * 90
          return Math.abs(deg - right) < 4 ? right : deg
        }
        if (first) delta = settle((first.rot ?? 0) + delta) - (first.rot ?? 0)
        const ids = new Set(g.ids)
        doc.live((d) => ({
          ...d,
          items: d.items.map((i) => {
            const from = ids.has(i.id) ? startItems.get(i.id) : undefined
            if (!from) return i
            const c = turn(center(from), g.middle, delta)
            const rot = Math.round((((((from.rot ?? 0) + delta) % 360) + 540) % 360 - 180) * 10) / 10
            return { ...i, x: c.x - from.w / 2, y: c.y - from.h / 2, rot: rot || undefined }
          }),
        }))
        return
      }
      case 'resize': {
        const { box, handle } = g
        // One turned item: the handles turn with it, so the pointer is taken into the item's own upright frame.
        const lone = g.ids.length === 1 ? g.origin.items.find((i) => i.id === g.ids[0]) : undefined
        if (lone?.rot) {
          const c0 = center(lone)
          const q = turn(p, c0, -lone.rot)
          let x1 = lone.x
          let y1 = lone.y
          let x2 = lone.x + lone.w
          let y2 = lone.y + lone.h
          if (handle.includes('w')) x1 = Math.min(q.x, x2 - 16)
          if (handle.includes('e')) x2 = Math.max(q.x, x1 + 16)
          if (handle.includes('n')) y1 = Math.min(q.y, y2 - 16)
          if (handle.includes('s')) y2 = Math.max(q.y, y1 + 16)
          if (g.keep || e.shiftKey) {
            const k = Math.max((x2 - x1) / lone.w, (y2 - y1) / lone.h)
            if (handle.includes('w')) x1 = x2 - lone.w * k
            else x2 = x1 + lone.w * k
            if (handle.includes('n')) y1 = y2 - lone.h * k
            else y2 = y1 + lone.h * k
          }
          if (!g.moved) {
            doc.checkpoint()
            g.moved = true
          }
          // The far corner stays where it is on the board: the new middle, turned back out of the upright frame.
          const c1 = turn({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, c0, lone.rot)
          const w = x2 - x1
          const h = y2 - y1
          doc.live((d) => ({ ...d, items: d.items.map((i) => (i.id === lone.id ? { ...i, x: c1.x - w / 2, y: c1.y - h / 2, w, h } : i)) }))
          return
        }
        let x1 = box.x
        let y1 = box.y
        let x2 = box.x + box.w
        let y2 = box.y + box.h
        if (handle.includes('w')) x1 = Math.min(p.x, x2 - 16)
        if (handle.includes('e')) x2 = Math.max(p.x, x1 + 16)
        if (handle.includes('n')) y1 = Math.min(p.y, y2 - 16)
        if (handle.includes('s')) y2 = Math.max(p.y, y1 + 16)
        if (g.keep || e.shiftKey) {
          const k = Math.max((x2 - x1) / box.w, (y2 - y1) / box.h)
          const w = box.w * k
          const h = box.h * k
          if (handle.includes('w')) x1 = x2 - w
          else x2 = x1 + w
          if (handle.includes('n')) y1 = y2 - h
          else y2 = y1 + h
        }
        if (!g.moved) {
          doc.checkpoint()
          g.moved = true
        }
        const sx = (x2 - x1) / box.w
        const sy = (y2 - y1) / box.h
        const ids = new Set(g.ids)
        const startItems = new Map(g.origin.items.map((i) => [i.id, i]))
        doc.live((d) => ({
          ...d,
          items: d.items.map((i) => {
            const from = ids.has(i.id) ? startItems.get(i.id) : undefined
            return from ? { ...i, x: x1 + (from.x - box.x) * sx, y: y1 + (from.y - box.y) * sy, w: Math.max(12, from.w * sx), h: Math.max(12, from.h * sy) } : i
          }),
        }))
        return
      }
      case 'marquee': {
        const r = normalize(g.start, p)
        setMarquee(r)
        // A frame only when the rectangle holds all of it: a rectangle drawn inside a frame picks what is in there.
        const inside = withGroups(
          doc.ref.current.items.filter((i) => !waiting.has(i.id)).filter((i) => (i.kind === 'frame' ? contains(r, i) && contains(r, { x: i.x + i.w, y: i.y + i.h }) : intersects(outer(i), r))).map((i) => i.id),
          doc.ref.current.items,
        )
        const linesIn = doc.ref.current.lines
          .filter((l) => {
            const geo = lineGeometry(l, byId)
            return contains(r, geo.a) && contains(r, geo.b)
          })
          .map((l) => l.id)
        setSelected([...new Set([...g.add, ...inside, ...linesIn])])
        return
      }
      case 'create':
        if (g.tool === 'shape' || g.tool === 'frame') setDraft({ rect: normalize(g.start, p) })
        return
      case 'draw': {
        const last = g.points[g.points.length - 1]
        if (Math.hypot(p.x - last[0], p.y - last[1]) * v.zoom < 1.5) return
        g.points.push([p.x, p.y, e.pressure || 0.5])
        setDraft({ ink: [...g.points] })
        return
      }
      case 'erase':
        erase(document.elementFromPoint(e.clientX, e.clientY))
        return
      case 'line': {
        const target = itemAt(p, g.from)
        const a = g.a.item ? center(byId.get(g.a.item)!) : g.a
        setDraft({ line: { a, b: target ? center(byId.get(target)!) : p, target } })
        return
      }
      case 'end': {
        g.moved = true
        const target = itemAt(p)
        doc.live((d) => ({ ...d, lines: d.lines.map((l) => (l.id === g.line ? { ...l, [g.which]: { item: target, x: p.x, y: p.y } } : l)) }))
        return
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    clearTimeout(press.current.timer)
    press.current.timer = 0
    if (pressed.current) {
      pressed.current = false
      return
    }
    const g = gesture.current
    // Two taps of a finger close together: what a double click does with a mouse.
    if (e.pointerType === 'touch' && e.type === 'pointerup' && (g?.kind === 'pan' || (g?.kind === 'move' && !g.moved))) {
      const s = local(e)
      const before = lastTap.current
      const now = e.timeStamp
      const still = g.kind === 'move' || Math.hypot(s.x - g.start.x, s.y - g.start.y) < 10
      if (still && now - before.time < 350 && Math.hypot(s.x - before.x, s.y - before.y) < 30) {
        gesture.current = null
        lastTap.current = { time: 0, x: 0, y: 0, handled: 0 }
        openAt(e)
        lastTap.current.handled = now
        return
      }
      if (still) lastTap.current = { ...before, time: now, x: s.x, y: s.y }
    }
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) {
        gesture.current = null
        pinch.current = null
      }
      return
    }
    gesture.current = null
    setGuides({ x: [], y: [] })
    if (!g) return
    const s = local(e)
    const p = toBoard(s, viewRef.current)

    switch (g.kind) {
      case 'marquee':
        setMarquee(null)
        return
      case 'create': {
        const drag = normalize(g.start, p)
        const dragged = drag.w * viewRef.current.zoom > 8 && drag.h * viewRef.current.zoom > 8
        if (g.tool === 'note') {
          add({ id: uid(), kind: 'note', x: p.x - 90, y: p.y - 90, w: 180, h: 180, color: tools.note, text: '' }, true)
        } else if (g.tool === 'frame') {
          const r = dragged ? drag : { x: p.x - 320, y: p.y - 200, w: 640, h: 400 }
          const number = doc.ref.current.items.filter((i) => i.kind === 'frame').length + 1
          add({ id: uid(), kind: 'frame', ...r, title: t('frames.numbered', { n: number }), color: '#ff8a70' })
        } else if (g.tool === 'text') {
          add({ id: uid(), kind: 'text', x: p.x, y: p.y - 14, w: dragged ? drag.w : 280, h: 30, text: '', size: 'm', color: 'auto' }, true)
        } else {
          const r = dragged ? drag : { x: p.x - 80, y: p.y - 60, w: 160, h: 120 }
          add({ id: uid(), kind: 'shape', ...r, shape: tools.shape, fill: '#60a5fa', stroke: 'none', text: '' })
        }
        setDraft(null)
        // Back to Select (unless the account keeps the tool), but keep the new note or text open for writing.
        if (prefs.tool_back || g.tool === 'note' || g.tool === 'text') setTools((t) => ({ ...t, tool: 'select' }))
        return
      }
      case 'draw': {
        setDraft(null)
        if (g.points.length < 2) g.points.push([g.points[0][0] + 0.5, g.points[0][1] + 0.5, 0.5])
        const marker = tools.tool === 'marker'
        const sizePx = marker ? tools.penSize * 4 : tools.penSize
        const pad = sizePx * 1.5
        const xs = g.points.map((q) => q[0])
        const ys = g.points.map((q) => q[1])
        const x = Math.min(...xs) - pad
        const y = Math.min(...ys) - pad
        const w = Math.max(...xs) - x + pad
        const h = Math.max(...ys) - y + pad
        const ink: InkItem = { id: uid(), kind: 'ink', x, y, w, h, ow: w, oh: h, points: g.points.map((q) => [q[0] - x, q[1] - y, q[2]]), color: tools.pen, size: sizePx, marker }
        // Drawn on a PDF: it belongs to the page showing, and turns away with it.
        const middleOf = { x: x + w / 2, y: y + h / 2 }
        const pdf = [...doc.ref.current.items].reverse().find((i) => i.kind === 'file' && i.ext === 'pdf' && contains(i, middleOf))
        if (pdf?.kind === 'file') ink.on = { item: pdf.id, page: pdf.page ?? 1 }
        doc.commit((d) => ({ ...d, items: [...d.items, ink] }))
        return
      }
      case 'line': {
        setDraft(null)
        const moved = Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y)
        // A click on a side handle adds a connected copy there, as in a mind map.
        if (moved < 4 && g.from && g.side) {
          const src = byId.get(g.from)
          if (!src) return
          const gap = 90
          const off = { top: { x: 0, y: -(src.h + gap) }, bottom: { x: 0, y: src.h + gap }, left: { x: -(src.w + gap), y: 0 }, right: { x: src.w + gap, y: 0 } }[g.side]
          const copy: Item =
            src.kind === 'note' ? { ...src, id: uid(), x: src.x + off.x, y: src.y + off.y, text: '', locked: false }
            : src.kind === 'shape' ? { ...src, id: uid(), x: src.x + off.x, y: src.y + off.y, text: '', locked: false }
            : { id: uid(), kind: 'note', x: src.x + off.x, y: src.y + off.y, w: 180, h: 180, color: tools.note, text: '' }
          const line: LineItem = { id: uid(), kind: 'line', a: { item: src.id, x: 0, y: 0 }, b: { item: copy.id, x: 0, y: 0 }, color: 'auto', width: 2, arrow: 'end', curve: true }
          doc.commit((d) => ({ items: [...d.items, copy], lines: [...d.lines, line] }))
          setSelected([copy.id])
          if (copy.kind === 'note' || copy.kind === 'shape') {
            setEditing(copy.id)
            freshText.current = null
          }
          return
        }
        if (moved < 8) return
        const target = itemAt(p, g.from)
        const line: LineItem = { id: uid(), kind: 'line', a: g.a, b: { item: target, x: p.x, y: p.y }, color: 'auto', width: 2, arrow: 'end', curve: !!(g.a.item && target) }
        doc.commit((d) => ({ ...d, lines: [...d.lines, line] }))
        setSelected([line.id])
        if (tools.tool === 'line' && prefs.tool_back) setTools((t) => ({ ...t, tool: 'select' }))
        return
      }
      case 'end':
        if (!g.moved) doc.forget()
        return
    }
  }

  /** What lies under the pointer. Not `event.target`: while the board holds the pointer (it captures it to follow a
   * drag), clicks and double-clicks name the board itself as their target. */
  const under = (e: { clientX: number; clientY: number }): HTMLElement => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        if (el.closest('[data-ui]') || el.closest('[data-item]') || el.closest('[data-line]')) return el as HTMLElement
      }
    }
    return root.current as HTMLElement
  }

  const menuAt = (e: { clientX: number; clientY: number }) => {
    const hit = under(e)
    if (hit.closest('[data-ui]')) return
    const s = local(e)
    const on = hit.closest<HTMLElement>('[data-item]')?.dataset.item ?? null
    if (on && !selectedSet.has(on)) setSelected(withGroups([on], doc.ref.current.items))
    setMenu({ x: s.x, y: s.y, at: toBoard(s, viewRef.current), on })
  }

  // A finger's double tap was handled on its own already; the browser may send a double click after it.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.timeStamp - lastTap.current.handled > 600) openAt(e)
  }

  /** What a double click does where it happens: write into a note, shape, text or frame name, open a link, or start
   * a text on the empty board. */
  const openAt = (e: { clientX: number; clientY: number }) => {
    if (readOnly) return
    const target = under(e)
    if (target.closest('[data-ui]')) return
    const id = target.closest<HTMLElement>('[data-item]')?.dataset.item
    const item = id ? byId.get(id) : undefined
    if (item?.kind === 'frame' && !item.locked) {
      setSelected([item.id])
      setEditing(item.id)
      freshText.current = null
      return
    }
    if (item && (item.kind === 'note' || item.kind === 'shape' || item.kind === 'text') && !item.locked) {
      setSelected([item.id])
      setEditing(item.id)
      freshText.current = null
      return
    }
    if (item?.kind === 'link') {
      window.open(item.url, '_blank', 'noopener')
      return
    }
    if (!item && tools.tool === 'select') {
      const p = toBoard(local(e), viewRef.current)
      add({ id: uid(), kind: 'text', x: p.x, y: p.y - 14, w: 280, h: 30, text: '', size: 'm', color: 'auto' }, true)
    }
  }

  const onText = useCallback((id: string, text: string) => doc.setText(id, text), [doc])
  const { commit, textOf, watchText } = doc
  const itemActions = useMemo(
    () => ({
      patch: (id: string, change: Partial<Item>) =>
        commit((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? ({ ...i, ...change } as Item) : i)) })),
      readOnly,
      textOf,
      watchText,
    }),
    [commit, textOf, watchText, readOnly],
  )
  const onMeasure = useCallback((id: string, h: number) => doc.quiet((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, h } : i)) })), [doc])

  // Writing starts a step in the history; leaving an empty new text removes it again.
  const startText = useRef<string | null>(null)
  useEffect(() => {
    if (editing && startText.current !== editing) {
      if (freshText.current !== editing) doc.checkpoint()
      startText.current = editing
    }
    if (!editing) startText.current = null
  }, [editing, doc])

  const onDone = useCallback(() => {
    setEditing((id) => {
      if (id) {
        const item = doc.ref.current.items.find((i) => i.id === id)
        if (item?.kind === 'text' && !item.text.trim()) {
          doc.live((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }))
          setSelected([])
        }
      }
      return null
    })
  }, [doc])

  // ---------- keys, paste, drop ----------

  useEffect(() => {
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || share || keys || asking || exporting || versions || presenting !== null) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (e.key === ' ' && !e.repeat) {
        setSpaceHeld(true)
        e.preventDefault()
        return
      }
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) doc.redo()
        else doc.undo()
        return
      }
      if (mod && k === 'y') {
        e.preventDefault()
        doc.redo()
        return
      }
      if (mod && k === 'a') {
        e.preventDefault()
        setSelected([...doc.ref.current.items.filter((i) => !waiting.has(i.id)).map((i) => i.id), ...doc.ref.current.lines.map((l) => l.id)])
        return
      }
      if (mod && k === 'd') {
        e.preventDefault()
        if (selected.length && !readOnly) duplicate(selected)
        return
      }
      if (mod && k === 'g') {
        e.preventDefault()
        if (readOnly || !selected.length) return
        if (e.shiftKey) ungroup(selected)
        else group(selected)
        return
      }
      if (mod && k === 'c') {
        const ids = new Set(selected)
        const d = doc.ref.current
        clipboard.current = { items: d.items.filter((i) => ids.has(i.id)), lines: d.lines.filter((l) => ids.has(l.id) || (l.a.item && ids.has(l.a.item) && l.b.item && ids.has(l.b.item))) }
        void navigator.clipboard?.writeText('nexcanvas:' + JSON.stringify(clipboard.current)).catch(() => undefined)
        return
      }
      if (mod && (e.key === '0' || k === '0')) {
        e.preventDefault()
        setView((v) => ({ zoom: 1, x: size.w / 2 - ((size.w / 2 - v.x) / v.zoom) * 1, y: size.h / 2 - ((size.h / 2 - v.y) / v.zoom) * 1 }))
        return
      }
      if (mod) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && !readOnly) {
        e.preventDefault()
        removeIds(selected)
        return
      }
      if (e.key === 'Escape') {
        setSelected([])
        setTool('select')
        return
      }
      if (e.key === 'Enter' && selected.length === 1) {
        const item = byId.get(selected[0])
        if (item && (item.kind === 'note' || item.kind === 'shape' || item.kind === 'text') && !readOnly) {
          e.preventDefault()
          setEditing(item.id)
          freshText.current = null
        }
        return
      }
      if (e.key.startsWith('Arrow') && selected.length && !readOnly) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const ids = new Set(selected)
        doc.commit((d) => ({ ...d, items: d.items.map((i) => (ids.has(i.id) && !i.locked ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }))
        return
      }
      if (e.key === '+' || e.key === '=') return zoomAt({ x: size.w / 2, y: size.h / 2 }, 1.2)
      if (e.key === '-') return zoomAt({ x: size.w / 2, y: size.h / 2 }, 1 / 1.2)
      if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) return fit()
      if (e.key === '?') return setKeys(true)
      const tool: Record<string, Tool> = { v: 'select', h: 'hand', n: 'note', s: 'shape', t: 'text', p: 'pen', m: 'marker', e: 'eraser', l: 'line', f: 'frame' }
      if (tool[k] && !e.shiftKey && !e.altKey) {
        if (readOnly && tool[k] !== 'select' && tool[k] !== 'hand') return
        setTool(tool[k])
      }
      if (k === 'i' && !readOnly) fileInput.current?.click()
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false)
    }
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target) || readOnly || share || asking || exporting || presenting !== null) return
      const data = e.clipboardData
      if (!data) return
      const files = [...data.files]
      if (files.length) {
        e.preventDefault()
        addFiles(files, middle())
        return
      }
      const text = data.getData('text/plain')
      if (!text) return
      e.preventDefault()
      if (text.startsWith('nexcanvas:')) {
        try {
          const copied = JSON.parse(text.slice(10)) as Doc
          const box = bounds(copied.items)
          const m = middle()
          const dx = box ? m.x - (box.x + box.w / 2) : 0
          const dy = box ? m.y - (box.y + box.h / 2) : 0
          const map = new Map<string, string>()
          const fresh = freshGroups(
            copied.items.map((i) => {
              const id = uid()
              map.set(i.id, id)
              return { ...i, id, x: i.x + dx, y: i.y + dy }
            }),
          )
          const freshLines = copied.lines.map((l) => ({
            ...l,
            id: uid(),
            a: l.a.item ? { ...l.a, item: map.get(l.a.item) } : { x: l.a.x + dx, y: l.a.y + dy },
            b: l.b.item ? { ...l.b, item: map.get(l.b.item) } : { x: l.b.x + dx, y: l.b.y + dy },
          }))
          doc.commit((d) => ({ items: [...d.items, ...fresh], lines: [...d.lines, ...freshLines] }))
          setSelected([...fresh.map((i) => i.id), ...freshLines.map((l) => l.id)])
        } catch {
          // Not ours after all.
        }
        return
      }
      const m = middle()
      if (/^https?:\/\/\S+$/i.test(text.trim())) addLink(text.trim(), m)
      else add({ id: uid(), kind: 'note', x: m.x - 90, y: m.y - 90, w: 180, h: 180, color: tools.note, text: text.slice(0, 2000) })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('paste', paste)
    }
  }, [selected, byId, doc, duplicate, removeIds, setTool, zoomAt, size, fit, readOnly, share, keys, asking, middle, addFiles, addLink, add, tools.note, group, ungroup, presenting, exporting, versions, waiting])

  // ---------- context actions ----------

  const actions: ContextActions = {
    change: (fn) => {
      const ids = new Set(selected)
      doc.commit((d) => ({
        items: d.items.map((i) => (ids.has(i.id) ? (fn(i) as Item) : i)),
        lines: d.lines.map((l) => (ids.has(l.id) ? (fn(l) as LineItem) : l)),
      }))
    },
    duplicate: () => duplicate(selected),
    remove: () => removeIds(selected),
    front: () => doc.commit((d) => ({ ...d, items: [...d.items.filter((i) => !selectedSet.has(i.id)), ...d.items.filter((i) => selectedSet.has(i.id))] })),
    back: () => doc.commit((d) => ({ ...d, items: [...d.items.filter((i) => selectedSet.has(i.id)), ...d.items.filter((i) => !selectedSet.has(i.id))] })),
    lock: (locked) => doc.commit((d) => ({ ...d, items: d.items.map((i) => (selectedSet.has(i.id) ? { ...i, locked } : i)) })),
    group: () => group(selected),
    ungroup: () => ungroup(selected),
    exportSelection: () => setExporting('selection'),
    arrange: (how) => {
      const moves = arrange(doc.ref.current.items, selectedSet, how)
      if (!moves.size) return
      doc.commit((d) => ({
        ...d,
        items: d.items.map((i) => {
          const move = moves.get(i.id)
          return move ? { ...i, x: i.x + move.dx, y: i.y + move.dy } : i
        }),
      }))
    },
  }

  // ---------- frames: the list, and presenting them one after the other ----------

  const frames = useMemo(() => framesInOrder(items), [items])
  const showFrame = useCallback((frame: Rect, pad = 90) => fit(frame, true, pad), [fit])

  useEffect(() => {
    if (presenting === null) return
    const frame = frames[presenting]
    if (!frame) {
      setPresenting(null)
      return
    }
    setSelected([])
    setEditing(null)
    showFrame(frame, 16)
  }, [presenting, frames, showFrame, size])

  useEffect(() => {
    if (presenting === null) return
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault()
        setPresenting((n) => (n === null ? n : Math.min(frames.length - 1, n + 1)))
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        setPresenting((n) => (n === null ? n : Math.max(0, n - 1)))
      } else if (e.key === 'Escape') {
        setPresenting(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [presenting, frames.length])

  // Presenting fills the screen where the browser allows it; leaving full screen ends presenting.
  const present = (from: number) => {
    setScenes(false)
    setPresenting(from)
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }
  useEffect(() => {
    const left = () => {
      if (!document.fullscreenElement) setPresenting(null)
    }
    document.addEventListener('fullscreenchange', left)
    return () => document.removeEventListener('fullscreenchange', left)
  }, [])
  useEffect(() => {
    if (presenting === null && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  }, [presenting])

  // ---------- drawing the overlay ----------

  const selBox = bounds(selItems)
  const screenBox = selBox ? { ...toScreen(selBox, view), w: selBox.w * view.zoom, h: selBox.h * view.zoom } : null
  // The box drawn around the selection: one turned item gets its own box, turned with it; else the upright box.
  const turned = selItems.length === 1 && selItems[0].rot ? selItems[0] : null
  const selOutline = turned
    ? { x: turned.x * view.zoom + view.x, y: turned.y * view.zoom + view.y, w: turned.w * view.zoom, h: turned.h * view.zoom, rot: turned.rot ?? 0 }
    : screenBox
      ? { ...screenBox, rot: 0 }
      : null
  const singleLine = selLines.length === 1 && selItems.length === 0 ? selLines[0] : null
  const lineGeo = singleLine ? lineGeometry(singleLine, byId) : null
  const barAt = (() => {
    if (editing || gesture.current?.kind === 'move' || gesture.current?.kind === 'rotate' || readOnly || presenting !== null) return null
    if (screenBox) return { x: screenBox.x + screenBox.w / 2, y: Math.max(64, screenBox.y - 14) }
    if (lineGeo) {
      const a = toScreen(lineGeo.a, view)
      const b = toScreen(lineGeo.b, view)
      return { x: (a.x + b.x) / 2, y: Math.max(64, Math.min(a.y, b.y) - 18) }
    }
    return null
  })()
  const single = selItems.length === 1 && !selItems[0].locked ? selItems[0] : null
  const allLocked = selItems.length > 0 && selItems.every((i) => i.locked)
  const cursor = spaceHeld || tools.tool === 'hand' ? 'grab' : tools.tool === 'select' ? 'default' : tools.tool === 'eraser' ? 'cell' : 'crosshair'
  const zoomPct = Math.round(view.zoom * 100)
  const phone = size.w < 640

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* The head row of the board, built like nexlore's note head: way back, place, star, who is here, share, more. */}
      <div className={'flex shrink-0 items-center gap-2 border-b border-ink-700/80 bg-ink-950 px-3 py-2 sm:px-5 ' + (presenting !== null ? 'hidden' : '')}>
        <Link to={space ? `/?space=${space.id}` : '/'} className="rounded-full p-1.5 text-mist-500 hover:bg-ink-850 hover:text-mist-100" aria-label={t('board.back')} title={t('board.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label={t('board.place')}>
          <Link to={`/?space=${board.space}`} className="hidden shrink-0 items-center gap-1.5 text-mist-500 hover:text-mist-100 sm:flex">
            <span className="h-2 w-2 rounded-full" style={{ background: space?.color }} />
            {space?.name}
          </Link>
          <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-mist-600 sm:block" />
          {title === null ? (
            <button type="button" onClick={() => !readOnly && setTitle(board.title)} className="truncate rounded px-1 font-semibold text-mist-100 hover:bg-ink-850" title={readOnly ? undefined : t('board.rename')}>
              {board.title}
            </button>
          ) : (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                if (title.trim()) boards.patch(board.id, { title: title.trim() })
                setTitle(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setTitle(null)
              }}
              className="nc-field w-56 py-1"
            />
          )}
        </nav>
        <button type="button" onClick={() => boards.patch(board.id, { favorite: !board.favorite })} aria-pressed={board.favorite} aria-label={board.favorite ? t('board.unfavorite') : t('board.favorite')} title={board.favorite ? t('board.unfavorite') : t('board.favorite')} className="rounded-full p-1.5 text-mist-500 hover:bg-ink-850 hover:text-mist-100">
          <Star className={'h-4 w-4 ' + (board.favorite ? 'fill-accent-500 text-accent-500' : '')} />
        </button>
        <span className={'hidden items-center gap-1.5 text-xs sm:inline-flex ' + (doc.status === 'live' ? 'text-mist-600' : 'text-warn-500')} role="status">
          <span className={'h-1.5 w-1.5 rounded-full ' + (doc.status === 'live' ? 'bg-ok-500' : 'bg-warn-500')} />
          {doc.status === 'gone' ? t('board.gone') : doc.status === 'offline' ? t('board.offline') : !doc.synced ? t('board.connecting') : readOnly ? t('board.readOnly') : t('board.live')}
        </span>
        {uploads > 0 && <span className="hidden text-xs text-mist-500 sm:inline">{t('media.uploading', { count: uploads })}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Peers peers={doc.peers} />
          <button type="button" onClick={() => setShare(true)} className="inline-flex items-center gap-2 rounded-full border border-accent-500/60 px-3 py-1.5 text-sm font-semibold text-accent-400 hover:bg-accent-500/10">
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('share.button')}</span>
          </button>
          <Popover label={t('common.more')} className="rounded-full p-1.5 text-mist-500 hover:bg-ink-850 hover:text-mist-100" button={<MoreHorizontal className="h-4 w-4" />}>
            {(close) => (
              <>
                <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); navigate(`/b/${boards.duplicate(board.id, t('board.copyOf', { title: board.title }))}`) }}>
                  <Copy className="h-4 w-4 text-mist-500" />
                  {t('board.duplicate')}
                </button>
                <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); setExporting('board') }}>
                  <ImageDown className="h-4 w-4 text-mist-500" />
                  {t('export.title')}
                </button>
                <a role="menuitem" className="nc-menu-item" href={boardsApi.exportUrl(board.id)} download onClick={() => close()}>
                  <FileDown className="h-4 w-4 text-mist-500" />
                  {t('canvasFile.export')}
                </a>
                <button type="button" role="menuitem" className="nc-menu-item" disabled={readOnly} onClick={() => { close(); canvasInput.current?.click() }}>
                  <FileUp className="h-4 w-4 text-mist-500" />
                  {t('canvasFile.import')}
                </button>
                <div className="my-1 h-px bg-ink-700" />
                <button type="button" role="menuitem" className="nc-menu-item" disabled={frames.length === 0} title={frames.length === 0 ? t('frames.none') : undefined} onClick={() => { close(); present(0) }}>
                  <Presentation className="h-4 w-4 text-mist-500" />
                  {t('frames.present')}
                </button>
                <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); setVersions(true) }}>
                  <History className="h-4 w-4 text-mist-500" />
                  {t('board.versions')}
                </button>
                <button type="button" role="menuitem" className="nc-menu-item" onClick={() => { close(); setKeys(true) }}>
                  <Keyboard className="h-4 w-4 text-mist-500" />
                  {t('keys.title')}
                </button>
                <div className="my-1 h-px bg-ink-700" />
                <button type="button" role="menuitem" className="nc-menu-item text-bad-500" disabled={readOnly} onClick={() => { close(); boards.trash(board.id); navigate('/') }}>
                  <Trash2 className="h-4 w-4" />
                  {t('board.trash')}
                </button>
              </>
            )}
          </Popover>
        </div>
      </div>

      <div
        ref={root}
        className={'nc-board min-h-0 flex-1 touch-none overflow-hidden outline-none ' + (presenting !== null ? 'fixed inset-0 z-40' : 'relative')}
        style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px`, backgroundImage: prefs.dots ? undefined : 'none', cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => doc.tell('pointer', null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          menuAt(e)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (readOnly) return
          const files = [...e.dataTransfer.files]
          const p = toBoard(local(e), viewRef.current)
          if (files.length) addFiles(files, p)
          else {
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
            if (url && /^https?:/i.test(url)) addLink(url, p)
          }
        }}
        data-testid="board"
      >
        <ItemActions.Provider value={itemActions}>
        <div ref={world} className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, ['--zoom' as string]: view.zoom }}>
          {/* Frames lie under everything else, whatever was made first. */}
          {drawOrder(items, waiting).map((item) => (
            <ItemView key={item.id} item={item} editing={editing === item.id} onText={onText} onDone={onDone} onMeasure={onMeasure} />
          ))}
          <Lines lines={lines} items={items} selected={selectedSet} />
          {draft?.ink && (
            <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
              <path d={outline(draft.ink, tools.tool === 'marker' ? tools.penSize * 4 : tools.penSize, tools.tool === 'marker', false)} fill={paint(tools.pen)} opacity={tools.tool === 'marker' ? 0.42 : 1} />
            </svg>
          )}
          {draft?.rect && <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent-500 bg-accent-500/10" style={{ left: draft.rect.x, top: draft.rect.y, width: draft.rect.w, height: draft.rect.h }} />}
          {draft?.line && (
            <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
              <path d={`M${draft.line.a.x} ${draft.line.a.y}L${draft.line.b.x} ${draft.line.b.y}`} stroke="var(--color-accent-500)" strokeWidth={2 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} />
              {draft.line.target && byId.get(draft.line.target) && (() => {
                const it = byId.get(draft.line.target)!
                return <rect x={it.x - 6} y={it.y - 6} width={it.w + 12} height={it.h + 12} rx={10} fill="none" stroke="var(--color-accent-500)" strokeWidth={2 / view.zoom} />
              })()}
            </svg>
          )}
        </div>

        <PeerPointers peers={doc.peers} view={view} items={byId} />

        </ItemActions.Provider>

        {/* Overlay in screen pixels: guides, marquee, selection with handles. */}
        {guides.x.map((x) => (
          <div key={'gx' + x} className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent-500/70" style={{ left: x * view.zoom + view.x }} />
        ))}
        {guides.y.map((y) => (
          <div key={'gy' + y} className="pointer-events-none absolute right-0 left-0 h-px bg-accent-500/70" style={{ top: y * view.zoom + view.y }} />
        ))}
        {marquee && (
          <div className="pointer-events-none absolute border border-accent-500 bg-accent-500/10" style={{ left: marquee.x * view.zoom + view.x, top: marquee.y * view.zoom + view.y, width: marquee.w * view.zoom, height: marquee.h * view.zoom }} />
        )}
        {selOutline && !editing && presenting === null && (
          <div className="pointer-events-none absolute" style={{ left: selOutline.x, top: selOutline.y, width: selOutline.w, height: selOutline.h, transform: selOutline.rot ? `rotate(${selOutline.rot}deg)` : undefined }}>
            <div className={'absolute -inset-px border-[1.5px] ' + (allLocked ? 'border-dashed border-mist-500' : 'border-accent-500')} />
            {!allLocked && !readOnly &&
              (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[])
                .filter((h) => h.length === 2 || (selItems.length === 1 && selItems[0].kind !== 'image'))
                .map((h) => (
                  <span
                    key={h}
                    data-handle="resize"
                    data-dir={h}
                    className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-accent-500 bg-ink-950 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
                    style={{
                      left: h.includes('w') ? -6 : h.includes('e') ? 'calc(100% - 4px)' : 'calc(50% - 5px)',
                      top: h.includes('n') ? -6 : h.includes('s') ? 'calc(100% - 4px)' : 'calc(50% - 5px)',
                      cursor: `${h}-resize`,
                    }}
                  />
                ))}
            {!allLocked && !readOnly && tools.tool === 'select' && selItems.some((i) => i.kind !== 'frame' && !i.locked) && (
              <span
                data-handle="rotate"
                title={t('canvas.rotate')}
                className="pointer-events-auto absolute grid h-6 w-6 cursor-grab place-items-center rounded-full border border-accent-500/70 bg-ink-950 text-accent-400 opacity-80 hover:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
                style={{ left: 'calc(100% + 10px)', top: 'calc(100% + 10px)' }}
              >
                <RotateCw className="pointer-events-none h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
            )}
            {single && single.kind !== 'ink' && single.kind !== 'frame' && !readOnly && tools.tool === 'select' &&
              (['top', 'right', 'bottom', 'left'] as Side[]).map((side) => {
                const pos = {
                  top: { x: selOutline.w / 2, y: -22 },
                  bottom: { x: selOutline.w / 2, y: selOutline.h + 22 },
                  left: { x: -22, y: selOutline.h / 2 },
                  right: { x: selOutline.w + 22, y: selOutline.h / 2 },
                }[side]
                return (
                  <span
                    key={side}
                    data-handle="connect"
                    data-for={single.id}
                    data-side={side}
                    title={t('canvas.connect')}
                    className="pointer-events-auto absolute grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair place-items-center rounded-full border border-accent-500/70 bg-ink-950 text-accent-400 opacity-70 transition hover:scale-110 hover:opacity-100"
                    style={{ left: pos.x, top: pos.y }}
                  >
                    <Plus className="pointer-events-none h-3 w-3" strokeWidth={2.5} />
                  </span>
                )
              })}
          </div>
        )}
        {lineGeo && singleLine && !readOnly &&
          (['a', 'b'] as const).map((which) => {
            const pt = toScreen(lineGeo[which], view)
            return <span key={which} data-handle="end" data-line={singleLine.id} data-which={which} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-accent-500 bg-ink-950 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']" style={{ left: pt.x, top: pt.y }} />
          })}

        {barAt && (selItems.length > 0 || selLines.length > 0) && (
          <div data-ui>
            <ContextBar items={selItems} lines={selLines} at={barAt} actions={actions} docked={phone} />
          </div>
        )}

        {/* Floating controls. data-ui keeps the board from treating clicks on them as board clicks. */}
        <div data-ui className="pointer-events-none absolute bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 sm:top-3 sm:bottom-auto">
          {!readOnly && presenting === null && (
            <Toolbar
              state={tools}
              set={(change) => {
                setTools((s) => ({ ...s, ...change }))
                setEditing(null)
              }}
              onUpload={() => fileInput.current?.click()}
              onLink={() => setAsking('link')}
              onCamera={() => cameraInput.current?.click()}
            />
          )}
        </div>
        <div data-ui className={'nc-float absolute top-3 left-3 z-20 flex items-center gap-0.5 p-1 sm:top-auto sm:bottom-4 sm:left-4 ' + (presenting !== null ? 'hidden' : '')}>
          <button type="button" className="nc-tool h-8 w-8" onClick={doc.undo} disabled={!doc.canUndo || readOnly} aria-label={t('canvas.undo')} title={`${t('canvas.undo')} (Ctrl Z)`}>
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" className="nc-tool h-8 w-8" onClick={doc.redo} disabled={!doc.canRedo || readOnly} aria-label={t('canvas.redo')} title={`${t('canvas.redo')} (Ctrl Shift Z)`}>
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-ink-700" />
          <button type="button" className="nc-tool hidden h-8 w-8 sm:flex" onClick={() => zoomAt({ x: size.w / 2, y: size.h / 2 }, 1 / 1.25)} aria-label={t('canvas.zoomOut')} title={`${t('canvas.zoomOut')} (−)`}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" className="hidden h-8 min-w-14 rounded-lg px-1 text-xs font-semibold text-mist-300 tabular-nums hover:bg-ink-800 sm:block" onClick={() => zoomAt({ x: size.w / 2, y: size.h / 2 }, 1 / view.zoom)} title={t('canvas.zoom100')}>
            {zoomPct} %
          </button>
          <button type="button" className="nc-tool hidden h-8 w-8 sm:flex" onClick={() => zoomAt({ x: size.w / 2, y: size.h / 2 }, 1.25)} aria-label={t('canvas.zoomIn')} title={`${t('canvas.zoomIn')} (+)`}>
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className="nc-tool h-8 w-8" onClick={() => fit()} aria-label={t('canvas.fit')} title={`${t('canvas.fit')} (Shift 1)`}>
            <Maximize className="h-4 w-4" />
          </button>
        </div>
        {presenting === null && (
          <div data-ui className="absolute top-3 right-3 z-20 flex items-start gap-2 sm:top-auto sm:right-4 sm:bottom-4 sm:items-end">
            {scenes && (
              <ScenesPanel
                frames={frames}
                onShow={(frame) => showFrame(frame)}
                onPresent={present}
                onClose={() => setScenes(false)}
              />
            )}
            <button type="button" onClick={() => setScenes((v) => !v)} aria-expanded={scenes} className="nc-float grid h-10 w-10 place-items-center text-mist-400 hover:text-mist-100" aria-label={t('frames.scenes')} title={t('frames.scenes')}>
              <Presentation className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setKeys(true)} className="nc-float hidden h-10 w-10 place-items-center text-mist-400 hover:text-mist-100 sm:grid" aria-label={t('keys.title')} title={`${t('keys.title')} (?)`}>
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
        )}
        {presenting !== null && frames[presenting] && (() => {
          const frame = frames[presenting]
          const box = { x: frame.x * view.zoom + view.x, y: frame.y * view.zoom + view.y, w: frame.w * view.zoom, h: frame.h * view.zoom }
          return (
            <>
              {/* Everything outside the frame goes dark, so the scene stands alone. */}
              <div className="pointer-events-none absolute rounded-[14px]" style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: '0 0 0 100vmax var(--color-ink-950)' }} />
              <div data-ui className="nc-float absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 p-1 opacity-60 transition-opacity hover:opacity-100">
                <button type="button" className="nc-tool h-9 w-9" disabled={presenting === 0} onClick={() => setPresenting(presenting - 1)} aria-label={t('frames.previous')} title={t('frames.previous')}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-28 px-2 text-center text-xs text-mist-300 tabular-nums">
                  <span className="block truncate font-semibold text-mist-100">{frame.title || t('frames.untitled')}</span>
                  {presenting + 1} / {frames.length}
                </span>
                <button type="button" className="nc-tool h-9 w-9" disabled={presenting === frames.length - 1} onClick={() => setPresenting(presenting + 1)} aria-label={t('frames.next')} title={t('frames.next')}>
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="mx-1 h-6 w-px bg-ink-700" />
                <button type="button" className="nc-tool h-9 w-9" onClick={() => setPresenting(null)} aria-label={t('frames.stop')} title={`${t('frames.stop')} (Esc)`}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </>
          )
        })()}

        {items.length === 0 && !readOnly && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex w-max gap-2">
                {(['yellow', 'pink', 'blue'] as const).map((c, i) => (
                  <span key={c} className="h-12 w-12 rounded shadow" style={{ background: NOTE_COLORS[c], transform: `rotate(${(i - 1) * 6}deg)` }} />
                ))}
              </div>
              <p className="text-base font-semibold text-mist-200">{t('canvas.emptyTitle')}</p>
              <p className="mt-1 text-sm text-mist-500">{t('canvas.emptyHint')}</p>
            </div>
          </div>
        )}

        {menu && (
          <div data-ui className="nc-menu absolute z-40" style={{ left: Math.min(menu.x, size.w - 210), top: Math.min(menu.y, size.h - 240) }} onPointerDown={(e) => e.stopPropagation()}>
            {menu.on ? (
              <>
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); duplicate(selected) }} disabled={readOnly}>{t('context.duplicate')}</button>
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); actions.front() }} disabled={readOnly}>{t('context.front')}</button>
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); actions.back() }} disabled={readOnly}>{t('context.back')}</button>
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); actions.lock(!allLocked) }} disabled={readOnly}>{allLocked ? t('context.unlock') : t('context.lock')}</button>
                <div className="my-1 h-px bg-ink-700" />
                <button type="button" className="nc-menu-item text-bad-500" onClick={() => { setMenu(null); removeIds(selected) }} disabled={readOnly}>{t('context.delete')}</button>
              </>
            ) : (
              <>
                <button type="button" className="nc-menu-item" disabled={readOnly} onClick={() => { setMenu(null); add({ id: uid(), kind: 'note', x: menu.at.x - 90, y: menu.at.y - 90, w: 180, h: 180, color: tools.note, text: '' }, true) }}>{t('menu.noteHere')}</button>
                <button type="button" className="nc-menu-item" disabled={readOnly} onClick={() => { setMenu(null); add({ id: uid(), kind: 'text', x: menu.at.x, y: menu.at.y - 14, w: 280, h: 30, text: '', size: 'm', color: 'auto' }, true) }}>{t('menu.textHere')}</button>
                <button type="button" className="nc-menu-item" disabled={readOnly} onClick={() => { setMenu(null); fileInput.current?.click() }}>{t('media.upload')}</button>
                <div className="my-1 h-px bg-ink-700" />
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); setSelected([...items.map((i) => i.id), ...lines.map((l) => l.id)]) }}>{t('menu.selectAll')}</button>
                <button type="button" className="nc-menu-item" onClick={() => { setMenu(null); fit() }}>{t('canvas.fit')}</button>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])], middle())
          e.target.value = ''
        }}
      />
      <input
        ref={canvasInput}
        type="file"
        accept=".canvas,.zip,application/json,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importCanvas(file)
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])], middle())
          e.target.value = ''
        }}
      />
      {notice && (
        <div role="status" className="nc-float pointer-events-none fixed bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 px-4 py-2.5 text-sm text-mist-200">
          {notice}
        </div>
      )}
      {share && <ShareDialog board={board} onClose={() => setShare(false)} />}
      {versions && <VersionsDialog boardId={board.id} readOnly={readOnly} onClose={() => setVersions(false)} />}
      {keys && <ShortcutsDialog onClose={() => setKeys(false)} />}
      {exporting && (
        <ExportDialog
          title={board.title}
          world={world}
          items={items}
          lines={lines}
          selection={exporting === 'selection' ? selected : []}
          frames={frames}
          onClose={() => setExporting(null)}
        />
      )}
      {asking === 'link' && <LinkDialog onClose={() => setAsking(null)} onAdd={(url) => { setAsking(null); addLink(url, middle()) }} />}
    </div>
  )
}

function LinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string) => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  return (
    <Dialog title={t('media.link')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) onAdd(url.trim())
        }}
      >
        <input className="nc-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com/…" type="url" />
        <p className="text-xs text-mist-600">{t('media.linkHint')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent">
            {t('media.add')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * A PDF on the board: one page at a time, drawn by pdf.js, with arrows to turn the pages. Drawing on it is the pen
 * on the board above it, so notes on a page stay where they were drawn.
 *
 * A page is drawn as sharp as the board's zoom asks for: in steps, a moment after the zoom stopped, into a canvas of its
 * own that takes the place of the old one only when it is done (no white flash), and never larger than `MAX_PIXELS`.
 *
 * The bytes are fetched like any other request of the page (the server hands PDFs out as downloads only; pdf.js reads
 * them here, nothing of the PDF ever runs as a page).
 */
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMediaUrl } from './media'
import type { Quill, SharedWords } from './quill'
import type { FileItem, Item, TextLook } from '../types'

/** What an item may change about itself on the board (a PDF its page). Given by the board page. */
// eslint-disable-next-line react-refresh/only-export-components
export const ItemActions = createContext<{
  patch: (id: string, change: Partial<Item>) => void
  readOnly: boolean
  /** The shared words of an item, for the editor writing in them (none where nobody writes). */
  words: (id: string) => SharedWords | null
  /** Changes the look of an item's words while someone writes, as part of the same step to undo. */
  setBase: (id: string, change: Partial<TextLook>) => void
  /** The editor open right now, for the bar above it; null when it closes. */
  setEditor: (editor: OpenEditor | null) => void
  undo: () => void
  redo: () => void
}>({
  patch: () => undefined,
  readOnly: true,
  words: () => null,
  setBase: () => undefined,
  setEditor: () => undefined,
  undo: () => undefined,
  redo: () => undefined,
})

/** The editor someone writes in: the item and its Quill. */
export interface OpenEditor {
  id: string
  quill: Quill
}

type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPageProxy> }
type PdfPageProxy = {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void }
}

const loaded = new Map<string, Promise<PdfDocument>>()

/** The board's zoom, for drawing PDF pages sharp at it. Given by the board page; 1 where there is none. */
// eslint-disable-next-line react-refresh/only-export-components
export const BoardZoom = createContext(1)

/** The most pixels one page is drawn with: an A4 page about 3,000 by 4,200, some 50 MB as a canvas. */
export const MAX_PIXELS = 12_000_000
/** How long the zoom has to rest before a page is drawn anew. */
const SETTLE_MS = 250

/** The zoom a page is drawn for: in half steps of two (1, 1.4, 2, 2.8, 4 …), never below 1. */
// eslint-disable-next-line react-refresh/only-export-components
export function sharpness(zoom: number): number {
  if (!(zoom > 1)) return 1
  return Math.min(16, 2 ** (Math.ceil(Math.log2(zoom) * 2) / 2))
}

/** The zoom something is drawn for: the board's in `sharpness` steps, a moment after it rests, and only when it is a
 * step further. Pages of PDFs and photos follow it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDrawnZoom(): number {
  const zoom = useContext(BoardZoom)
  const [drawnFor, setDrawnFor] = useState(() => sharpness(zoom))
  useEffect(() => {
    const step = sharpness(zoom)
    if (step === drawnFor) return
    const timer = window.setTimeout(() => setDrawnFor(step), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [zoom, drawnFor])
  return drawnFor
}

/** The scale pdf.js draws a page with, for its width on the board, the zoom and the screen's pixels. */
// eslint-disable-next-line react-refresh/only-export-components
export function drawScale(base: { width: number; height: number }, width: number, zoom: number, pixelRatio: number): number {
  const wanted = (width * sharpness(zoom) * Math.max(1, pixelRatio)) / base.width
  const most = Math.sqrt(MAX_PIXELS / Math.max(1, base.width * base.height))
  return Math.max(0.1, Math.min(wanted, most))
}

/** How pdf.js reads a PDF. No scripts, no forms, no fonts from elsewhere: a PDF is shown, nothing more. What pdf.js
 * reads besides it (character maps of Chinese, Japanese and Korean fonts, without which their words stay blank;
 * standard fonts; picture decoders; the CMYK profile) comes from this server, put there by the build
 * (vite.config.ts, pdfjsData). */
// eslint-disable-next-line react-refresh/only-export-components
export function readOptions(data: Uint8Array, base: string): Record<string, unknown> {
  const extras = base + 'pdfjs/'
  return {
    data,
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: extras + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: extras + 'standard_fonts/',
    wasmUrl: extras + 'wasm/',
    iccUrl: extras + 'iccs/',
  }
}

async function open(media: string, address: string): Promise<PdfDocument> {
  let found = loaded.get(media)
  if (!found) {
    found = (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      const response = await fetch(address, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('pdf ' + response.status)
      const data = new Uint8Array(await response.arrayBuffer())
      return (await pdfjs.getDocument(readOptions(data, import.meta.env.BASE_URL) as never).promise) as unknown as PdfDocument
    })()
    loaded.set(media, found)
    found.catch(() => loaded.delete(media))
  }
  return found
}

export function PdfPage({ item }: { item: FileItem }) {
  const { t } = useTranslation()
  const { patch, readOnly } = useContext(ItemActions)
  const mediaUrl = useMediaUrl()
  const address = mediaUrl(item.media)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawnFor = useDrawnZoom()
  const [pages, setPages] = useState(item.pages ?? 0)
  const [failed, setFailed] = useState(false)
  const page = Math.max(1, Math.min(item.page ?? 1, pages || 1))

  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void } | null = null
    open(item.media, address).then(
      async (pdf) => {
        if (cancelled) return
        setPages(pdf.numPages)
        const proxy = await pdf.getPage(Math.min(page, pdf.numPages))
        const target = canvas.current
        if (cancelled || !target) return
        const base = proxy.getViewport({ scale: 1 })
        // Sharp at the size it has on the screen: its width on the board, the zoom, the screen's pixels.
        const viewport = proxy.getViewport({ scale: drawScale(base, item.w, drawnFor, window.devicePixelRatio || 1) })
        const fresh = document.createElement('canvas')
        fresh.width = Math.round(viewport.width)
        fresh.height = Math.round(viewport.height)
        const context = fresh.getContext('2d')
        if (!context) return
        const render = proxy.render({ canvas: fresh, canvasContext: context, viewport })
        task = render
        try {
          await render.promise
        } catch {
          return
        }
        if (cancelled) return
        // Only now the shown page changes, so zooming never shows it blank.
        target.width = fresh.width
        target.height = fresh.height
        target.getContext('2d')?.drawImage(fresh, 0, 0)
        fresh.width = 0
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [item.media, address, page, item.w, drawnFor])

  const turn = (by: number) => patch(item.id, { page: Math.max(1, Math.min(pages, page + by)) } as Partial<Item>)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-ink-600 bg-white shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]">
      <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-white">
        {failed ? (
          <div className="grid h-full w-full place-items-center bg-ink-800 text-mist-500">
            <FileText className="h-10 w-10" />
          </div>
        ) : (
          <canvas ref={canvas} className="h-auto max-h-full w-full object-contain" />
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-ink-700 bg-ink-850 px-2 py-1.5" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-mist-200" title={item.name}>
          {item.name}
        </span>
        {pages > 1 && (
          <>
            <button type="button" disabled={readOnly || page <= 1} onClick={() => turn(-1)} className="rounded p-0.5 text-mist-400 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-30" aria-label={t('pdf.previous')} title={t('pdf.previous')}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-mist-500 tabular-nums">
              {page}/{pages}
            </span>
            <button type="button" disabled={readOnly || page >= pages} onClick={() => turn(1)} className="rounded p-0.5 text-mist-400 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-30" aria-label={t('pdf.next')} title={t('pdf.next')}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
        <a href={mediaUrl(item.media, { download: true })} download className="rounded p-0.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100" title={t('media.download')} aria-label={t('media.download')}>
          <Download className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

/**
 * A PDF on the board: one page at a time, drawn by pdf.js, with arrows to turn the pages. Drawing on it is the pen
 * on the board above it, so notes on a page stay where they were drawn.
 *
 * The bytes are fetched like any other request of the page (the server hands PDFs out as downloads only; pdf.js reads
 * them here, nothing of the PDF ever runs as a page).
 */
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMediaUrl } from './media'
import type { FileItem, Item } from '../types'

/** What an item may change about itself on the board (a PDF its page). Given by the board page. */
// eslint-disable-next-line react-refresh/only-export-components
export const ItemActions = createContext<{
  patch: (id: string, change: Partial<Item>) => void
  readOnly: boolean
  /** The words of an item as the shared document has them this very moment (newer than any picture drawn). */
  textOf: (id: string) => string | undefined
  /** Calls back the moment someone else's words reach the item (not later with the next picture). */
  watchText: (id: string, changed: () => void) => () => void
}>({
  patch: () => undefined,
  readOnly: true,
  textOf: () => undefined,
  watchText: () => () => undefined,
})

type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPageProxy> }
type PdfPageProxy = {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void }
}

const loaded = new Map<string, Promise<PdfDocument>>()

async function open(media: string, address: string): Promise<PdfDocument> {
  let found = loaded.get(media)
  if (!found) {
    found = (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      const response = await fetch(address, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('pdf ' + response.status)
      const data = new Uint8Array(await response.arrayBuffer())
      // No scripts, no forms, no fonts from elsewhere: a PDF is shown, nothing more.
      const options: Record<string, unknown> = { data, isEvalSupported: false, enableXfa: false }
      return (await pdfjs.getDocument(options as never).promise) as unknown as PdfDocument
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
        // Sharp at the size it has on the board, on screens with more pixels too; never absurdly large.
        const scale = Math.min(3, (item.w * Math.min(2, window.devicePixelRatio || 1)) / base.width)
        const viewport = proxy.getViewport({ scale })
        target.width = Math.round(viewport.width)
        target.height = Math.round(viewport.height)
        const context = target.getContext('2d')
        if (!context) return
        const render = proxy.render({ canvas: target, canvasContext: context, viewport })
        task = render
        await render.promise.catch(() => undefined)
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [item.media, address, page, item.w])

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

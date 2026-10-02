import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '../../components/Dialog'
import { bounds, center, contains, lineGeometry, type Rect } from '../geometry'
import { pdfOfPictures, type PdfPage } from '../pdf'
import type { FrameItem, Item, LineItem } from '../types'

type Scope = 'board' | 'selection' | 'scenes'
type Format = 'png' | 'pdf'

/** The largest side of an exported picture, in pixels; browsers refuse canvases much larger. */
const MAX_SIDE = 8000
/** Board pixels to PDF points: 100 % on the board prints at the size it shows on a screen. */
const POINTS = 0.75

function fileName(title: string, ext: string): string {
  return (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'nexcanvas') + '.' + ext
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Board, selection or every frame as a picture or a PDF. Drawn from the board as it is on the screen (the same fonts,
 * photos and PDF pages), at twice the size for sharp prints, in the current light or dark look.
 */
export function ExportDialog({ title, world, items, lines, selection, frames, onClose }: {
  title: string
  world: RefObject<HTMLDivElement | null>
  items: Item[]
  lines: LineItem[]
  selection: string[]
  frames: FrameItem[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const picked = new Set(selection)
  const hasSelection = items.some((i) => picked.has(i.id))
  const [scope, setScope] = useState<Scope>(hasSelection ? 'selection' : 'board')
  const [format, setFormat] = useState<Format>('png')
  const [background, setBackground] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(false)
  const effectiveFormat = scope === 'scenes' ? 'pdf' : format

  /** What goes into the picture: the selection with what lies in its frames, or everything. */
  const chosen = (): Set<string> | null => {
    if (scope !== 'selection') return null
    const ids = new Set(selection)
    for (const frame of items.filter((i) => i.kind === 'frame' && ids.has(i.id))) {
      for (const item of items) if (contains(frame, center(item))) ids.add(item.id)
    }
    for (const line of lines) if ((!line.a.item || ids.has(line.a.item)) && (!line.b.item || ids.has(line.b.item)) && (line.a.item || line.b.item || ids.has(line.id))) ids.add(line.id)
    return ids
  }

  const area = (ids: Set<string> | null): Rect | null => {
    const byId = new Map(items.map((i) => [i.id, i]))
    const shown = ids ? items.filter((i) => ids.has(i.id)) : items
    const ends = (ids ? lines.filter((l) => ids.has(l.id)) : lines).flatMap((l) => {
      const g = lineGeometry(l, byId)
      return [{ x: g.a.x, y: g.a.y, w: 0, h: 0 }, { x: g.b.x, y: g.b.y, w: 0, h: 0 }]
    })
    // Frame names sit above the frame; room for them.
    const names = shown.filter((i) => i.kind === 'frame').map((f) => ({ x: f.x, y: f.y - 28, w: f.w, h: 28 }))
    return bounds([...shown, ...ends, ...names])
  }

  const draw = async (rect: Rect, ids: Set<string> | null, solid: boolean) => {
    const el = world.current
    if (!el) throw new Error('no board')
    const { toCanvas } = await import('html-to-image')
    const pad = 32
    const scale = Math.min(2, MAX_SIDE / Math.max(rect.w + pad * 2, rect.h + pad * 2))
    const width = Math.ceil((rect.w + pad * 2) * scale)
    const height = Math.ceil((rect.h + pad * 2) * scale)
    const backdrop = getComputedStyle(el.parentElement ?? document.body).backgroundColor
    const before = el.style.getPropertyValue('--zoom')
    // Frame names are sized against the zoom on screen; in the picture they keep their size on the board.
    el.style.setProperty('--zoom', '1')
    try {
      return await toCanvas(el, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,
        backgroundColor: solid ? backdrop : undefined,
        cacheBust: false,
        style: { transform: `translate(${(pad - rect.x) * scale}px, ${(pad - rect.y) * scale}px) scale(${scale})`, transformOrigin: '0 0' },
        filter: (node) => {
          if (!(node instanceof Element)) return true
          if (node.hasAttribute('data-export-skip')) return false
          const item = node.getAttribute('data-item')
          if (item && ids && !ids.has(item)) return false
          const line = node.getAttribute('data-line')
          if (line && ids && !ids.has(line)) return false
          return true
        },
      })
    } finally {
      el.style.setProperty('--zoom', before)
    }
  }

  const jpegPage = async (canvas: HTMLCanvasElement, scaleBack: number): Promise<PdfPage> => {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', 0.92))
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, w: (canvas.width / scaleBack) * POINTS, h: (canvas.height / scaleBack) * POINTS }
  }

  const run = async () => {
    setBusy(true)
    setProblem(false)
    try {
      if (scope === 'scenes') {
        const pages: PdfPage[] = []
        for (const frame of frames) {
          const canvas = await draw({ x: frame.x, y: frame.y, w: frame.w, h: frame.h }, null, true)
          pages.push(await jpegPage(canvas, canvas.width / (frame.w + 64)))
        }
        save(pdfOfPictures(pages), fileName(title, 'pdf'))
      } else {
        const ids = chosen()
        const rect = area(ids)
        if (!rect) throw new Error('empty')
        const canvas = await draw(rect, ids, format === 'pdf' || background)
        if (format === 'png') {
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
          save(blob, fileName(title, 'png'))
        } else {
          save(pdfOfPictures([await jpegPage(canvas, canvas.width / (rect.w + 64))]), fileName(title, 'pdf'))
        }
      }
      onClose()
    } catch (error) {
      console.warn('Export failed', error)
      setProblem(true)
      setBusy(false)
    }
  }

  const choice = (active: boolean, disabled = false) =>
    'flex-1 rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-40 ' + (active && !disabled ? 'border-accent-500 bg-accent-500/10 text-mist-100' : 'border-ink-700 text-mist-300 hover:border-ink-600')

  return (
    <Dialog title={t('export.title')} onClose={onClose}>
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-mist-500">{t('export.what')}</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={choice(scope === 'board')} aria-pressed={scope === 'board'} onClick={() => setScope('board')}>
              {t('export.board')}
            </button>
            <button type="button" className={choice(scope === 'selection', !hasSelection)} disabled={!hasSelection} aria-pressed={scope === 'selection'} onClick={() => setScope('selection')}>
              {t('export.selectionShort')}
            </button>
            <button type="button" className={choice(scope === 'scenes', frames.length === 0)} disabled={frames.length === 0} aria-pressed={scope === 'scenes'} onClick={() => setScope('scenes')} title={frames.length === 0 ? t('frames.none') : undefined}>
              {t('export.scenes', { count: frames.length })}
            </button>
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-mist-500">{t('export.format')}</legend>
          <div className="flex gap-2">
            <button type="button" className={choice(effectiveFormat === 'png', scope === 'scenes')} disabled={scope === 'scenes'} aria-pressed={effectiveFormat === 'png'} onClick={() => setFormat('png')}>
              PNG
            </button>
            <button type="button" className={choice(effectiveFormat === 'pdf')} aria-pressed={effectiveFormat === 'pdf'} onClick={() => setFormat('pdf')}>
              PDF
            </button>
          </div>
          {scope === 'scenes' && <p className="text-xs text-mist-500">{t('export.scenesHint')}</p>}
        </fieldset>
        {effectiveFormat === 'png' && (
          <label className="flex items-center gap-2 text-sm text-mist-300">
            <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} className="accent-[var(--color-accent-500)]" />
            {t('export.background')}
          </label>
        )}
        {problem && <p role="alert" className="text-sm text-bad-500">{t('export.failed')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => void run()} disabled={busy} className="nc-btn nc-btn-accent">
            {busy ? t('export.busy') : t('export.go')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

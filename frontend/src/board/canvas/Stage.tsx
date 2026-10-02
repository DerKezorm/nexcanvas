/**
 * Presenting the frames of a board one after the other, on the board itself and on its public page: the frame in
 * view, everything around it dark, a small bar with the way forward and back, the keys of a presenter.
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { FrameItem, View } from '../types'

/** Arrow keys, space, page keys and Enter go on; Escape ends. Leaving full screen ends it too. */
// eslint-disable-next-line react-refresh/only-export-components
export function useStageKeys(at: number | null, count: number, go: (next: number | null) => void) {
  useEffect(() => {
    if (at === null) return
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault()
        go(Math.min(count - 1, at + 1))
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        go(Math.max(0, at - 1))
      } else if (e.key === 'Escape') {
        go(null)
      }
    }
    const left = () => {
      if (!document.fullscreenElement) go(null)
    }
    window.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', left)
    return () => {
      window.removeEventListener('keydown', key)
      document.removeEventListener('fullscreenchange', left)
    }
  }, [at, count, go])
  useEffect(() => {
    if (at === null && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  }, [at])
}

/** Asks the browser for the whole screen; where it says no, presenting still works inside the window. */
// eslint-disable-next-line react-refresh/only-export-components
export function wholeScreen() {
  void document.documentElement.requestFullscreen?.().catch(() => undefined)
}

export function Stage({ frames, at, view, go }: { frames: FrameItem[]; at: number; view: View; go: (next: number | null) => void }) {
  const { t } = useTranslation()
  const frame = frames[at]
  if (!frame) return null
  const box = { x: frame.x * view.zoom + view.x, y: frame.y * view.zoom + view.y, w: frame.w * view.zoom, h: frame.h * view.zoom }
  return (
    <>
      {/* Everything outside the frame goes dark, so the scene stands alone. */}
      <div className="pointer-events-none absolute rounded-[14px]" style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: '0 0 0 100vmax var(--color-ink-950)' }} />
      <div data-ui className="nc-float absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 p-1 opacity-60 transition-opacity hover:opacity-100">
        <button type="button" className="nc-tool h-9 w-9" disabled={at === 0} onClick={() => go(at - 1)} aria-label={t('frames.previous')} title={t('frames.previous')}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-28 px-2 text-center text-xs text-mist-300 tabular-nums">
          <span className="block truncate font-semibold text-mist-100">{frame.title || t('frames.untitled')}</span>
          {at + 1} / {frames.length}
        </span>
        <button type="button" className="nc-tool h-9 w-9" disabled={at === frames.length - 1} onClick={() => go(at + 1)} aria-label={t('frames.next')} title={t('frames.next')}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-6 w-px bg-ink-700" />
        <button type="button" className="nc-tool h-9 w-9" onClick={() => go(null)} aria-label={t('frames.stop')} title={`${t('frames.stop')} (Esc)`}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </>
  )
}

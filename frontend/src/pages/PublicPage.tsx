/**
 * A board on its public page: anybody with the link looks, nobody changes anything. No account, no live connection;
 * the picture is what the server has, photos come through the page's own address.
 */
import { Lock, Maximize, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { api, ApiError } from '../api/client'
import { ItemView } from '../board/canvas/ItemView'
import { Lines } from '../board/canvas/Lines'
import { MediaBase } from '../board/canvas/media'
import { bounds } from '../board/geometry'
import type { Doc, Item, LineItem, View } from '../board/types'
import { Logo } from '../components/Logo'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { errorText } from '../lib/errors'

type Page = { title: string; picture?: { items: Item[]; lines: LineItem[] }; password?: boolean; token?: string }

const nothing = () => undefined

export function PublicPage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const [page, setPage] = useState<Page | null>(null)
  const [missing, setMissing] = useState(false)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; view: View } | null>(null)

  useEffect(() => {
    api<Page>(`/api/public/${encodeURIComponent(token)}`).then(setPage, () => setMissing(true))
  }, [token])

  const doc: Doc = page?.picture ?? { items: [], lines: [] }

  const fit = useCallback(() => {
    const el = root.current
    const box = bounds(doc.items)
    if (!el || !box) return
    const zoom = Math.min(1.4, (el.clientWidth - 120) / Math.max(box.w, 1), (el.clientHeight - 120) / Math.max(box.h, 1))
    setView({ zoom, x: el.clientWidth / 2 - (box.x + box.w / 2) * zoom, y: el.clientHeight / 2 - (box.y + box.h / 2) * zoom })
  }, [doc.items])
  useEffect(fit, [fit])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const p = { x: e.clientX - r.left, y: e.clientY - r.top }
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const zoom = Math.min(4, Math.max(0.1, v.zoom * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0035)))
          const k = zoom / v.zoom
          return { zoom, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }
        })
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [page])

  if (missing) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <Logo className="mx-auto h-10 w-10" />
          <p className="mt-4 text-mist-400">{t('public.missing')}</p>
        </div>
      </div>
    )
  }
  if (!page) return null
  if (page.password) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <form
          className="w-full max-w-sm space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-6"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              setPage(await api<Page>(`/api/public/${encodeURIComponent(token)}`, { method: 'POST', body: { password } }))
            } catch (error) {
              setProblem(error instanceof ApiError ? error.code : 'internal_error')
            }
          }}
        >
          <div className="flex items-center gap-2 text-mist-100">
            <Lock className="h-4 w-4" />
            <h1 className="text-lg font-semibold">{t('public.locked')}</h1>
          </div>
          <input className="nc-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder={t('share.password')} />
          {problem && <p className="text-sm text-bad-500">{errorText(problem)}</p>}
          <button type="submit" className="nc-btn nc-btn-accent w-full">
            {t('public.open')}
          </button>
        </form>
      </div>
    )
  }

  const byId = new Map(doc.items.map((i) => [i.id, i]))
  return (
    <MediaBase.Provider value={`/api/public/${encodeURIComponent(page.token ?? token)}/media/`}>
      <div className="flex h-dvh flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-ink-700/80 px-4 py-2.5">
          <Logo className="h-7 w-7" />
          <h1 className="min-w-0 flex-1 truncate font-semibold text-mist-100">{page.title}</h1>
          <span className="hidden text-xs text-mist-600 sm:inline">{t('public.readOnly')}</span>
          <ThemeSwitcher />
        </header>
        <div
          ref={root}
          className="nc-board relative min-h-0 flex-1 touch-none overflow-hidden"
          style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px`, cursor: 'grab' }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, view }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (d) setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y })
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {doc.items.map((item) => (
              <ItemView key={item.id} item={item} editing={false} onText={nothing} onDone={nothing} onMeasure={nothing} />
            ))}
            <Lines lines={doc.lines} items={doc.items} selected={new Set()} />
          </div>
          <div className="nc-float absolute bottom-4 left-4 flex items-center gap-0.5 p-1">
            <button type="button" className="nc-tool h-8 w-8" onClick={() => setView((v) => ({ ...v, zoom: v.zoom / 1.25 }))} aria-label={t('canvas.zoomOut')}>
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-14 text-center text-xs font-semibold text-mist-300 tabular-nums">{Math.round(view.zoom * 100)} %</span>
            <button type="button" className="nc-tool h-8 w-8" onClick={() => setView((v) => ({ ...v, zoom: v.zoom * 1.25 }))} aria-label={t('canvas.zoomIn')}>
              <Plus className="h-4 w-4" />
            </button>
            <button type="button" className="nc-tool h-8 w-8" onClick={fit} aria-label={t('canvas.fit')}>
              <Maximize className="h-4 w-4" />
            </button>
          </div>
          {byId.size === 0 && <p className="absolute inset-0 grid place-items-center text-sm text-mist-600">{t('public.empty')}</p>}
        </div>
      </div>
    </MediaBase.Provider>
  )
}

import { ExternalLink, FileText, Globe, Lock } from 'lucide-react'
import { memo, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { shapePath, shapeTextBox } from '../geometry'
import { inkPath } from '../ink'
import { NOTE_COLORS, paint, textOn } from '../palette'
import type { Item, TextSize } from '../types'

// eslint-disable-next-line react-refresh/only-export-components
export const TEXT_SIZES: Record<TextSize, number> = { s: 15, m: 20, l: 28, xl: 44 }

/** Notes shrink their text as it grows, so a full note stays readable without scrolling. */
function noteFont(text: string, w: number): number {
  const base = Math.max(12, Math.min(26, w / 8))
  const n = text.length
  if (n < 30) return base
  if (n < 80) return base * 0.82
  if (n < 160) return base * 0.68
  return base * 0.56
}

interface Props {
  item: Item
  editing: boolean
  onText: (id: string, text: string) => void
  onDone: () => void
  onMeasure: (id: string, h: number) => void
}

/** One item on the board, in board coordinates. The board's transform scales it. */
export const ItemView = memo(function ItemView({ item, editing, onText, onDone, onMeasure }: Props) {
  // Drawings and empty frames only answer on their lines, so what lies under them stays reachable.
  const thin = item.kind === 'ink' || (item.kind === 'shape' && item.fill === 'none')
  const style = { left: item.x, top: item.y, width: item.w, height: item.kind === 'text' ? undefined : item.h, pointerEvents: thin ? ('none' as const) : undefined }
  return (
    <div data-item={item.id} data-kind={item.kind} className="absolute select-none" style={style}>
      <Body item={item} editing={editing} onText={onText} onDone={onDone} onMeasure={onMeasure} />
      {item.locked && (
        <span className="pointer-events-none absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-ink-800 text-mist-400 shadow">
          <Lock className="h-3 w-3" />
        </span>
      )}
    </div>
  )
})

function Editor({ value, onChange, onDone, className, style }: { value: string; onChange: (v: string) => void; onDone: () => void; className: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          onDone()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={'resize-none border-0 bg-transparent outline-none ' + className}
      style={style}
      spellCheck
    />
  )
}

function Body({ item, editing, onText, onDone, onMeasure }: Props) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)

  // Text items take the height of their words; the board learns it, so selection and lines fit.
  useLayoutEffect(() => {
    if (item.kind !== 'text' || !box.current) return
    const h = box.current.offsetHeight
    if (Math.abs(h - item.h) > 1) onMeasure(item.id, h)
  })

  switch (item.kind) {
    case 'note': {
      const size = noteFont(item.text, item.w)
      return (
        <div className="nc-note-text flex h-full w-full rounded-[3px] p-[7%] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.45)]" style={{ background: NOTE_COLORS[item.color] }}>
          {editing ? (
            <Editor value={item.text} onChange={(v) => onText(item.id, v)} onDone={onDone} className="nc-note-text h-full w-full leading-snug" style={{ fontSize: size, color: '#1c1917' }} />
          ) : (
            <div className="h-full w-full overflow-hidden leading-snug break-words whitespace-pre-wrap" style={{ fontSize: size, color: '#1c1917' }}>
              {item.text || <span className="opacity-40">{t('canvas.notePlaceholder')}</span>}
            </div>
          )}
        </div>
      )
    }
    case 'shape': {
      const tb = shapeTextBox(item.shape, item.w, item.h)
      const color = textOn(item.fill)
      const size = Math.max(12, Math.min(22, Math.min(item.w, item.h) / 4.5))
      return (
        <>
          <svg className="absolute inset-0 overflow-visible" width={item.w} height={item.h} aria-hidden="true">
            <path
              d={shapePath(item.shape, item.w, item.h)}
              fill={paint(item.fill)}
              stroke={item.stroke === 'none' ? 'none' : paint(item.stroke)}
              strokeWidth={2.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'visiblePainted' }}
            />
            {item.fill === 'none' && item.stroke === 'none' && <path d={shapePath(item.shape, item.w, item.h)} fill="none" stroke="var(--color-ink-600)" strokeDasharray="4 4" />}
            {item.fill === 'none' && <path d={shapePath(item.shape, item.w, item.h)} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'stroke' }} />}
          </svg>
          <div className="absolute flex items-center justify-center text-center font-medium" style={{ left: tb.x, top: tb.y, width: tb.w, height: tb.h, color, fontSize: size, lineHeight: 1.2 }}>
            {editing ? (
              <Editor value={item.text} onChange={(v) => onText(item.id, v)} onDone={onDone} className="h-full w-full text-center font-medium" style={{ color, fontSize: size, lineHeight: 1.2, paddingTop: Math.max(0, tb.h / 2 - size * 0.7) }} />
            ) : (
              <span className="pointer-events-none line-clamp-4 px-1 break-words whitespace-pre-wrap">{item.text}</span>
            )}
          </div>
        </>
      )
    }
    case 'text': {
      const size = TEXT_SIZES[item.size]
      const style = { fontSize: size, color: paint(item.color), fontWeight: item.size === 'xl' || item.size === 'l' ? 700 : 400, lineHeight: 1.25, fontFamily: item.hand ? 'var(--font-hand)' : undefined }
      return (
        <div ref={box} className="relative min-h-[1.25em] w-full">
          <div className={'break-words whitespace-pre-wrap ' + (editing ? 'invisible' : '')} style={style}>
            {(item.text || ' ') + (item.text.endsWith('\n') ? ' ' : '')}
            {!item.text && !editing && <span className="opacity-40">{t('canvas.textPlaceholder')}</span>}
          </div>
          {editing && <Editor value={item.text} onChange={(v) => onText(item.id, v)} onDone={onDone} className="absolute inset-0 h-full w-full overflow-hidden p-0" style={style} />}
        </div>
      )
    }
    case 'ink':
      return (
        <svg className="absolute inset-0 overflow-visible" width={item.w} height={item.h} viewBox={`0 0 ${item.ow} ${item.oh}`} preserveAspectRatio="none" aria-hidden="true" style={{ pointerEvents: 'none' }}>
          <path d={inkPath(item)} fill={paint(item.color)} opacity={item.marker ? 0.42 : 1} />
          <path d={inkPath(item)} fill="transparent" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all' }} />
        </svg>
      )
    case 'image':
      return (
        <figure className="relative h-full w-full overflow-hidden rounded-md bg-ink-800 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.55)]">
          <img src={item.src} alt={item.caption ?? ''} draggable={false} className="h-full w-full object-cover" />
          {item.caption && <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-xs font-medium text-white">{item.caption}</figcaption>}
        </figure>
      )
    case 'file':
      return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]">
          <div className="relative flex flex-1 items-center justify-center bg-ink-800 p-4">
            <div className="relative h-full max-h-40 w-[70%] rounded-sm bg-white p-3 shadow">
              {[70, 90, 60, 85, 40, 75, 55].map((w, i) => (
                <div key={i} className="mb-1.5 h-1.5 rounded bg-zinc-300" style={{ width: `${w}%` }} />
              ))}
              <span className="absolute right-1.5 bottom-1.5 rounded bg-rose-600 px-1 py-px text-[9px] font-bold text-white uppercase">{item.ext}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-ink-700 px-3 py-2.5">
            <FileText className="h-4 w-4 shrink-0 text-mist-500" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-mist-100">{item.name}</div>
              <div className="truncate text-[11px] text-mist-600">
                {item.ext.toUpperCase()}
                {item.pages ? ` · ${t('canvas.pages', { count: item.pages })}` : ''} · {item.sizeLabel}
              </div>
            </div>
          </div>
        </div>
      )
    case 'link':
      return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]">
          <div className="relative flex flex-1 items-center justify-center" style={{ background: `linear-gradient(135deg, hsl(${item.hue} 45% 42%), hsl(${item.hue + 40} 50% 28%))` }}>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/90 text-lg font-bold" style={{ color: `hsl(${item.hue} 45% 30%)` }}>
              {item.site.slice(0, 1).toUpperCase()}
            </span>
            <ExternalLink className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-white/70" />
          </div>
          <div className="px-3 py-2.5">
            <div className="line-clamp-2 text-sm leading-snug font-medium text-mist-100">{item.title}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-mist-600">
              <Globe className="h-3 w-3" />
              <span className="truncate">{item.site}</span>
            </div>
          </div>
        </div>
      )
  }
}

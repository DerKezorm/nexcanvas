import {
  Circle,
  Diamond,
  Eraser,
  Frame as FrameIcon,
  Hand,
  Hexagon,
  Highlighter,
  ImagePlus,
  Link2,
  MessageSquare,
  MousePointer2,
  MoveUpRight,
  PenLine,
  RectangleHorizontal,
  Spline,
  Square,
  Star,
  StickyNote,
  Triangle,
  Type,
  Upload,
  Camera,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { NOTE_COLORS, PALETTE, paint } from '../palette'
import type { NoteColor, ShapeKind } from '../types'

export type Tool = 'select' | 'hand' | 'note' | 'shape' | 'text' | 'pen' | 'marker' | 'eraser' | 'line' | 'frame'

// eslint-disable-next-line react-refresh/only-export-components
export const SHAPES: { kind: ShapeKind; Icon: typeof Square }[] = [
  { kind: 'rect', Icon: Square },
  { kind: 'round', Icon: RectangleHorizontal },
  { kind: 'ellipse', Icon: Circle },
  { kind: 'triangle', Icon: Triangle },
  { kind: 'diamond', Icon: Diamond },
  { kind: 'hexagon', Icon: Hexagon },
  { kind: 'star', Icon: Star },
  { kind: 'arrow', Icon: MoveUpRight },
  { kind: 'speech', Icon: MessageSquare },
]

export interface ToolState {
  tool: Tool
  shape: ShapeKind
  note: NoteColor
  pen: string
  penSize: number
}

/** Opens a small panel next to a tool; closes on a click elsewhere. */
function Flyout({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className="nc-float absolute top-full left-1/2 mt-2 -translate-x-1/2 p-2">
      {children}
    </div>
  )
}

function Key({ k }: { k: string }) {
  return <span className="pointer-events-none absolute right-0.5 bottom-0 text-[9px] font-semibold text-mist-600">{k}</span>
}

/** The tools, floating over the top of the board as in Freeform: pick, then click or drag on the board. */
export function Toolbar({
  state,
  set,
  onUpload,
  onLink,
  onCamera,
}: {
  state: ToolState
  set: (change: Partial<ToolState>) => void
  onUpload: () => void
  onLink: () => void
  onCamera: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'shape' | 'pen' | 'media' | 'note' | null>(null)
  const close = () => setOpen(null)
  const ShapeIcon = SHAPES.find((s) => s.kind === state.shape)?.Icon ?? Square

  const tool = (id: Tool, label: string, Icon: typeof Square, key: string, extra?: () => void) => (
    <button
      type="button"
      className="nc-tool"
      aria-pressed={state.tool === id}
      aria-label={`${label} (${key})`}
      title={`${label} (${key})`}
      onClick={() => {
        set({ tool: id })
        extra?.()
      }}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      <Key k={key} />
    </button>
  )

  return (
    <div className="nc-float pointer-events-auto flex items-center gap-0.5 p-1" role="toolbar" aria-label={t('canvas.tools')}>
      {tool('select', t('tools.select'), MousePointer2, 'V')}
      {tool('hand', t('tools.hand'), Hand, 'H')}
      <span className="mx-1 h-6 w-px bg-ink-700" />
      <div className="relative">
        <button
          type="button"
          className="nc-tool"
          aria-pressed={state.tool === 'note'}
          aria-label={`${t('tools.note')} (N)`}
          title={`${t('tools.note')} (N)`}
          onClick={() => {
            if (state.tool === 'note') setOpen(open === 'note' ? null : 'note')
            set({ tool: 'note' })
          }}
        >
          <StickyNote className="h-[18px] w-[18px]" strokeWidth={1.8} />
          <span className="absolute right-1.5 bottom-1.5 h-2 w-2 rounded-full ring-1 ring-black/20" style={{ background: NOTE_COLORS[state.note] }} />
        </button>
        <Flyout open={open === 'note'} onClose={close}>
          <div className="flex gap-1.5">
            {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
              <button key={c} type="button" aria-label={t(`colors.${c}`)} title={t(`colors.${c}`)} aria-pressed={state.note === c} onClick={() => { set({ note: c, tool: 'note' }); close() }} className={'h-7 w-7 rounded-md ring-offset-2 ring-offset-ink-850 ' + (state.note === c ? 'ring-2 ring-accent-500' : '')} style={{ background: NOTE_COLORS[c] }} />
            ))}
          </div>
        </Flyout>
      </div>
      <div className="relative">
        <button
          type="button"
          className="nc-tool"
          aria-pressed={state.tool === 'shape'}
          aria-label={`${t('tools.shape')} (S)`}
          title={`${t('tools.shape')} (S)`}
          aria-expanded={open === 'shape'}
          onClick={() => {
            setOpen(open === 'shape' ? null : 'shape')
            set({ tool: 'shape' })
          }}
        >
          <ShapeIcon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          <Key k="S" />
        </button>
        <Flyout open={open === 'shape'} onClose={close}>
          <div className="grid w-max grid-cols-3 gap-1">
            {SHAPES.map(({ kind, Icon }) => (
              <button key={kind} type="button" className="nc-tool" aria-pressed={state.shape === kind} aria-label={t(`shapes.${kind}`)} title={t(`shapes.${kind}`)} onClick={() => { set({ shape: kind, tool: 'shape' }); close() }}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ))}
          </div>
        </Flyout>
      </div>
      {tool('text', t('tools.text'), Type, 'T')}
      {tool('line', t('tools.line'), Spline, 'L')}
      {tool('frame', t('tools.frame'), FrameIcon, 'F')}
      <span className="mx-1 h-6 w-px bg-ink-700" />
      <div className="relative">
        <button
          type="button"
          className="nc-tool"
          aria-pressed={state.tool === 'pen' || state.tool === 'marker'}
          aria-label={`${t('tools.pen')} (P)`}
          title={`${t('tools.pen')} (P)`}
          onClick={() => {
            if (state.tool === 'pen' || state.tool === 'marker') setOpen(open === 'pen' ? null : 'pen')
            else set({ tool: 'pen' })
          }}
        >
          {state.tool === 'marker' ? <Highlighter className="h-[18px] w-[18px]" strokeWidth={1.8} /> : <PenLine className="h-[18px] w-[18px]" strokeWidth={1.8} />}
          <span className="absolute right-1.5 bottom-1.5 h-2 w-2 rounded-full ring-1 ring-black/20" style={{ background: paint(state.pen) }} />
        </button>
        <Flyout open={open === 'pen'} onClose={close}>
          <div className="w-max space-y-2">
            <div className="flex gap-1">
              <button type="button" className="nc-tool" aria-pressed={state.tool === 'pen'} onClick={() => set({ tool: 'pen' })} title={t('tools.pen')} aria-label={t('tools.pen')}>
                <PenLine className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <button type="button" className="nc-tool" aria-pressed={state.tool === 'marker'} onClick={() => set({ tool: 'marker' })} title={`${t('tools.marker')} (M)`} aria-label={t('tools.marker')}>
                <Highlighter className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <span className="mx-1 h-9 w-px bg-ink-700" />
              {[3, 6, 12].map((size) => (
                <button key={size} type="button" className="nc-tool" aria-pressed={state.penSize === size} onClick={() => set({ penSize: size })} title={t('tools.size', { size })} aria-label={t('tools.size', { size })}>
                  <span className="rounded-full bg-current" style={{ width: size + 2, height: size + 2 }} />
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {PALETTE.map((c) => (
                <button key={c} type="button" aria-label={c === 'auto' ? t('colors.auto') : c} title={c === 'auto' ? t('colors.auto') : c} aria-pressed={state.pen === c} onClick={() => set({ pen: c })} className={'h-6 w-6 rounded-full ring-offset-2 ring-offset-ink-850 ' + (state.pen === c ? 'ring-2 ring-accent-500' : '')} style={{ background: paint(c) }} />
              ))}
            </div>
          </div>
        </Flyout>
      </div>
      {tool('eraser', t('tools.eraser'), Eraser, 'E')}
      <span className="mx-1 h-6 w-px bg-ink-700" />
      <div className="relative">
        <button type="button" className="nc-tool" aria-label={t('tools.media')} title={t('tools.media')} aria-expanded={open === 'media'} onClick={() => setOpen(open === 'media' ? null : 'media')}>
          <ImagePlus className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <Flyout open={open === 'media'} onClose={close}>
          <div className="w-60">
            <button type="button" className="nc-menu-item" onClick={() => { close(); onUpload() }}>
              <Upload className="h-4 w-4 text-mist-500" />
              {t('media.upload')}
            </button>
            <button type="button" className="nc-menu-item" onClick={() => { close(); onLink() }}>
              <Link2 className="h-4 w-4 text-mist-500" />
              {t('media.link')}
            </button>
            <button type="button" className="nc-menu-item" onClick={() => { close(); onCamera() }}>
              <Camera className="h-4 w-4 text-mist-500" />
              {t('media.camera')}
            </button>
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-mist-600">{t('media.dropHint')}</p>
          </div>
        </Flyout>
      </div>
    </div>
  )
}

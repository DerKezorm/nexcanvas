import { ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpToLine, Copy, Lock, LockOpen, Minus, PaintBucket, Spline, Trash2, Waypoints } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { FILLS, NOTE_COLORS, PALETTE, paint } from '../palette'
import type { Item, LineItem, NoteColor, TextSize } from '../types'
import { SHAPES } from './Toolbar'

export interface ContextActions {
  /** Changes every selected item or line of the given kind. */
  change: (fn: (thing: Item | LineItem) => Item | LineItem) => void
  duplicate: () => void
  remove: () => void
  front: () => void
  back: () => void
  lock: (locked: boolean) => void
}

function Btn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="nc-tool h-8 w-8" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

function Swatches({ colors, value, onPick, label }: { colors: readonly string[]; value?: string; onPick: (c: string) => void; label: (c: string) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={label(c)}
          title={label(c)}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className={'h-6 w-6 rounded-full ring-offset-2 ring-offset-ink-850 ' + (value === c ? 'ring-2 ring-accent-500' : 'ring-1 ring-ink-600')}
          style={c === 'none' ? { background: 'repeating-linear-gradient(45deg, transparent 0 4px, var(--color-ink-600) 4px 5px)' } : { background: paint(c) }}
        />
      ))}
    </div>
  )
}

/**
 * The bar above a selection, as in Freeform: what the selection is decides what it offers. Colour always
 * comes first, the rest follows the kind; arrange, lock and delete are always there.
 */
export function ContextBar({ items, lines, at, actions }: { items: Item[]; lines: LineItem[]; at: { x: number; y: number }; actions: ContextActions }) {
  const { t } = useTranslation()
  const [panel, setPanel] = useState<'fill' | 'stroke' | 'shape' | null>(null)
  const kinds = new Set<string>([...items.map((i) => i.kind), ...lines.map(() => 'line')])
  const only = kinds.size === 1 ? [...kinds][0] : null
  const first = items[0]
  const locked = items.length > 0 && items.every((i) => i.locked)
  const colorLabel = (c: string) => (c === 'auto' ? t('colors.auto') : c === 'none' ? t('colors.none') : c)

  const setFill = (c: string) =>
    actions.change((x) => {
      if (x.kind === 'shape') return { ...x, fill: c }
      if (x.kind === 'text' || x.kind === 'ink' || x.kind === 'line') return { ...x, color: c }
      return x
    })

  return (
    <div className="pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-full" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="nc-float flex items-center gap-0.5 p-1">
        {only === 'note' && (
          <div className="flex gap-1 px-1">
            {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(`colors.${c}`)}
                title={t(`colors.${c}`)}
                aria-pressed={first?.kind === 'note' && first.color === c}
                onClick={() => actions.change((x) => (x.kind === 'note' ? { ...x, color: c } : x))}
                className={'h-6 w-6 rounded-md ring-offset-2 ring-offset-ink-850 ' + (first?.kind === 'note' && first.color === c ? 'ring-2 ring-accent-500' : '')}
                style={{ background: NOTE_COLORS[c] }}
              />
            ))}
          </div>
        )}
        {(only === 'shape' || only === 'text' || only === 'ink' || only === 'line') && (
          <Btn label={only === 'shape' ? t('context.fill') : t('context.color')} onClick={() => setPanel(panel === 'fill' ? null : 'fill')} pressed={panel === 'fill'}>
            <span className="h-4 w-4 rounded-full ring-1 ring-ink-600" style={{ background: paint(first?.kind === 'shape' ? first.fill : first && 'color' in first ? first.color : lines[0]?.color ?? 'auto') }} />
          </Btn>
        )}
        {only === 'shape' && (
          <>
            <Btn label={t('context.stroke')} onClick={() => setPanel(panel === 'stroke' ? null : 'stroke')} pressed={panel === 'stroke'}>
              <PaintBucket className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.shape')} onClick={() => setPanel(panel === 'shape' ? null : 'shape')} pressed={panel === 'shape'}>
              <Waypoints className="h-4 w-4" />
            </Btn>
          </>
        )}
        {only === 'text' && (
          <div className="flex px-1">
            {(['s', 'm', 'l', 'xl'] as TextSize[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={first?.kind === 'text' && first.size === s}
                onClick={() => actions.change((x) => (x.kind === 'text' ? { ...x, size: s } : x))}
                className={'h-8 min-w-8 rounded-lg px-1.5 text-xs font-semibold ' + (first?.kind === 'text' && first.size === s ? 'bg-accent-500/15 text-accent-400' : 'text-mist-400 hover:bg-ink-800')}
                title={t(`context.size.${s}`)}
              >
                {s.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={first?.kind === 'text' && !!first.hand}
              onClick={() => actions.change((x) => (x.kind === 'text' ? { ...x, hand: !x.hand } : x))}
              className={'h-8 rounded-lg px-2 text-sm ' + (first?.kind === 'text' && first.hand ? 'bg-accent-500/15 text-accent-400' : 'text-mist-400 hover:bg-ink-800')}
              style={{ fontFamily: 'var(--font-hand)' }}
              title={t('context.hand')}
            >
              Aa
            </button>
          </div>
        )}
        {only === 'line' && lines[0] && (
          <>
            <Btn label={t('context.arrowNone')} pressed={lines[0].arrow === 'none'} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, arrow: 'none' } : x))}>
              <Minus className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.arrowEnd')} pressed={lines[0].arrow === 'end'} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, arrow: 'end' } : x))}>
              <ArrowRight className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.arrowBoth')} pressed={lines[0].arrow === 'both'} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, arrow: 'both' } : x))}>
              <ArrowLeftRight className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.curve')} pressed={lines[0].curve} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, curve: !x.curve } : x))}>
              <Spline className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.dashed')} pressed={!!lines[0].dashed} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, dashed: !x.dashed } : x))}>
              <span className="w-4 border-t-2 border-dashed border-current" />
            </Btn>
            {[2, 4].map((w) => (
              <Btn key={w} label={t('context.width', { width: w })} pressed={lines[0].width === w} onClick={() => actions.change((x) => (x.kind === 'line' ? { ...x, width: w } : x))}>
                <span className="w-4 rounded bg-current" style={{ height: w }} />
              </Btn>
            ))}
          </>
        )}
        {(only || items.length > 0) && <span className="mx-0.5 h-6 w-px bg-ink-700" />}
        {items.length > 0 && (
          <>
            <Btn label={t('context.front')} onClick={actions.front}>
              <ArrowUpToLine className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.back')} onClick={actions.back}>
              <ArrowDownToLine className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.duplicate')} onClick={actions.duplicate}>
              <Copy className="h-4 w-4" />
            </Btn>
            <Btn label={locked ? t('context.unlock') : t('context.lock')} pressed={locked} onClick={() => actions.lock(!locked)}>
              {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            </Btn>
          </>
        )}
        <Btn label={t('context.delete')} onClick={actions.remove}>
          <Trash2 className="h-4 w-4 text-bad-500" />
        </Btn>
      </div>
      {panel && (
        <div className="nc-float absolute top-full left-1/2 mt-2 w-max max-w-72 -translate-x-1/2 p-2.5">
          {panel === 'fill' && (
            <Swatches
              colors={only === 'shape' ? FILLS : PALETTE}
              value={first?.kind === 'shape' ? first.fill : first && 'color' in first ? first.color : lines[0]?.color}
              onPick={(c) => setFill(c)}
              label={colorLabel}
            />
          )}
          {panel === 'stroke' && (
            <Swatches colors={['none', ...PALETTE]} value={first?.kind === 'shape' ? first.stroke : undefined} onPick={(c) => actions.change((x) => (x.kind === 'shape' ? { ...x, stroke: c } : x))} label={colorLabel} />
          )}
          {panel === 'shape' && (
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map(({ kind, Icon }) => (
                <button key={kind} type="button" className="nc-tool h-8 w-8" aria-pressed={first?.kind === 'shape' && first.shape === kind} title={t(`shapes.${kind}`)} aria-label={t(`shapes.${kind}`)} onClick={() => actions.change((x) => (x.kind === 'shape' ? { ...x, shape: kind } : x))}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

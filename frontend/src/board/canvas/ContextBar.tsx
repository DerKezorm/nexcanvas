import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignCenter, AlignLeft, AlignRight,
  ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpToLine, Bold, Copy, Eye, EyeOff, Group, ImageDown, Italic, LayoutGrid, Lock, LockOpen, Minus, PaintBucket, Spline, Strikethrough, Trash2, Type, Underline, Ungroup, Waypoints,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { FILLS, NOTE_COLORS, PALETTE, paint } from '../palette'
import type { Arrange } from '../arrange'
import { canSpread } from '../spread'
import type { SpanLook } from '../rich'
import { alignOf, chosenSize, hasWords, lookOn, textSizeOf } from '../textLook'
import { OUTLINE_WEIGHTS, outlineOf, type FrameItem, type Item, type LineItem, type NoteColor, type TextAlign } from '../types'
import { SizeChoices, SizeLabel } from './SizePicker'
import { SHAPES } from './Toolbar'

export interface ContextActions {
  /** Changes every selected item or line of the given kind. */
  change: (fn: (thing: Item | LineItem) => Item | LineItem) => void
  duplicate: () => void
  remove: () => void
  front: () => void
  back: () => void
  lock: (locked: boolean) => void
  group: () => void
  ungroup: () => void
  /** Opens the export with what is selected. */
  exportSelection: () => void
  /** Hides the content of the selected frame from the others, or shows it again. */
  hide: (hidden: boolean) => void
  /** Whether this person may show a hidden frame's content again: whoever hid it, and who manages the space. */
  mayReveal: (frame: FrameItem) => boolean
  arrange: (how: Arrange) => void
  /** Lays out every page of the selected PDF beside it. */
  spread: () => void
  /** Switches a look for all the words of the selected notes, shapes and texts. */
  look: (look: SpanLook) => void
  /** One size for all the words of the selected notes, shapes and texts (null: their kind's own); parts lose theirs. */
  size: (size: number | null) => void
  /** The colour of the selected texts, for all their words: parts lose a colour of their own. */
  textColor: (color: string) => void
}

const ALIGN: { align: TextAlign; Icon: typeof AlignLeft }[] = [
  { align: 'left', Icon: AlignLeft },
  { align: 'center', Icon: AlignCenter },
  { align: 'right', Icon: AlignRight },
]

const LOOKS = [
  { look: 'bold', Icon: Bold },
  { look: 'italic', Icon: Italic },
  { look: 'underline', Icon: Underline },
  { look: 'strike', Icon: Strikethrough },
] as const

const ARRANGE: { how: Arrange; Icon: typeof AlignStartVertical }[] = [
  { how: 'left', Icon: AlignStartVertical },
  { how: 'centerX', Icon: AlignCenterVertical },
  { how: 'right', Icon: AlignEndVertical },
  { how: 'spreadX', Icon: AlignHorizontalDistributeCenter },
  { how: 'top', Icon: AlignStartHorizontal },
  { how: 'centerY', Icon: AlignCenterHorizontal },
  { how: 'bottom', Icon: AlignEndHorizontal },
  { how: 'spreadY', Icon: AlignVerticalDistributeCenter },
]

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
export function ContextBar({ items, lines, at, actions, docked = false }: {
  items: Item[]
  lines: LineItem[]
  at: { x: number; y: number }
  actions: ContextActions
  /** On a phone: the bar sits at the bottom above the tools, scrolls sideways, and its panels open upwards. */
  docked?: boolean
}) {
  const { t } = useTranslation()
  const [panel, setPanel] = useState<'fill' | 'stroke' | 'shape' | 'arrange' | 'text' | 'size' | null>(null)
  const kinds = new Set<string>([...items.map((i) => i.kind), ...lines.map(() => 'line')])
  const only = kinds.size === 1 ? [...kinds][0] : null
  const first = items[0]
  const locked = items.length > 0 && items.every((i) => i.locked)
  // One group, and nothing else: then the bar offers to take it apart.
  const grouped = items.length > 1 && !!items[0].group && items.every((i) => i.group === items[0].group)
  // Notes, shapes and texts, and nothing else: then the bar offers the look of their words.
  const worded = items.length > 0 && lines.length === 0 && items.every(hasWords) ? items.filter(hasWords) : []
  const head = worded[0]
  // The size the words have: the one chosen, a text's step, or none (a note or a shape fits its words in).
  const size = head ? (head.kind === 'text' ? textSizeOf(head) : chosenSize(head)) : null
  const colorLabel = (c: string) => (c === 'auto' ? t('colors.auto') : c === 'none' ? t('colors.none') : c)

  const setFill = (c: string) =>
    actions.change((x) => {
      if (x.kind === 'shape') return { ...x, fill: c }
      if (x.kind === 'ink' || x.kind === 'line' || x.kind === 'frame') return { ...x, color: c }
      return x
    })
  const pickColor = (c: string) => (only === 'text' ? actions.textColor(c) : setFill(c))

  return (
    <div
      className={'pointer-events-auto absolute z-30 -translate-x-1/2 ' + (docked ? 'max-w-[calc(100vw-16px)]' : '-translate-y-full')}
      style={docked ? { left: '50%', bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 52px)' } : { left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className={'nc-float flex items-center gap-0.5 p-1 ' + (docked ? 'nc-scroll overflow-x-auto' : '')}>
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
        {(only === 'shape' || only === 'text' || only === 'ink' || only === 'line' || only === 'frame') && (
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
        {only === 'frame' && items.length === 1 && first?.kind === 'frame' && (!first.hidden || actions.mayReveal(first)) && (
          <Btn label={first.hidden ? t('hide.show') : t('hide.hide')} pressed={!!first.hidden} onClick={() => actions.hide(!first.hidden)}>
            {first.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Btn>
        )}
        {items.length === 1 && first && canSpread(first) && (
          <Btn label={t('pdf.spread')} onClick={actions.spread}>
            <LayoutGrid className="h-4 w-4" />
          </Btn>
        )}
        {head && (
          <>
            <Btn label={t('fontSize.title')} onClick={() => setPanel(panel === 'size' ? null : 'size')} pressed={panel === 'size'}>
              <SizeLabel value={size} />
            </Btn>
            <Btn label={t('context.text')} onClick={() => setPanel(panel === 'text' ? null : 'text')} pressed={panel === 'text'}>
              <Type className="h-4 w-4" />
            </Btn>
          </>
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
            {items.filter((i) => i.kind !== 'frame').length > 1 && (
              <Btn label={t('arrange.title')} onClick={() => setPanel(panel === 'arrange' ? null : 'arrange')} pressed={panel === 'arrange'}>
                <AlignStartVertical className="h-4 w-4" />
              </Btn>
            )}
            <Btn label={t('context.front')} onClick={actions.front}>
              <ArrowUpToLine className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.back')} onClick={actions.back}>
              <ArrowDownToLine className="h-4 w-4" />
            </Btn>
            <Btn label={t('context.duplicate')} onClick={actions.duplicate}>
              <Copy className="h-4 w-4" />
            </Btn>
            {grouped ? (
              <Btn label={t('context.ungroup')} onClick={actions.ungroup}>
                <Ungroup className="h-4 w-4" />
              </Btn>
            ) : (
              items.length > 1 && (
                <Btn label={t('context.group')} onClick={actions.group}>
                  <Group className="h-4 w-4" />
                </Btn>
              )
            )}
            <Btn label={locked ? t('context.unlock') : t('context.lock')} pressed={locked} onClick={() => actions.lock(!locked)}>
              {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            </Btn>
            <Btn label={t('export.selection')} onClick={actions.exportSelection}>
              <ImageDown className="h-4 w-4" />
            </Btn>
          </>
        )}
        <Btn label={t('context.delete')} onClick={actions.remove}>
          <Trash2 className="h-4 w-4 text-bad-500" />
        </Btn>
      </div>
      {panel && (
        <div className={'nc-float absolute left-1/2 w-max max-w-72 -translate-x-1/2 p-2.5 ' + (docked ? 'bottom-full mb-2' : 'top-full mt-2')}>
          {panel === 'fill' && (
            <Swatches
              colors={only === 'shape' ? FILLS : PALETTE}
              value={first?.kind === 'shape' ? first.fill : first && 'color' in first ? first.color : lines[0]?.color}
              onPick={pickColor}
              label={colorLabel}
            />
          )}
          {panel === 'stroke' && (
            <div className="flex flex-col gap-2.5">
              <Swatches colors={['none', ...PALETTE]} value={first?.kind === 'shape' ? first.stroke : undefined} onPick={(c) => actions.change((x) => (x.kind === 'shape' ? { ...x, stroke: c } : x))} label={colorLabel} />
              <div className="flex items-center gap-0.5" role="group" aria-label={t('context.weight')}>
                {OUTLINE_WEIGHTS.map((w) => (
                  <Btn key={w} label={t(`context.weights.${OUTLINE_WEIGHTS.indexOf(w)}`)} pressed={first?.kind === 'shape' && outlineOf(first) === w} onClick={() => actions.change((x) => (x.kind === 'shape' ? { ...x, weight: w } : x))}>
                    <span className="w-5 rounded-full bg-current" style={{ height: Math.max(1, w * 0.75) }} />
                  </Btn>
                ))}
              </div>
            </div>
          )}
          {panel === 'size' && head && (
            <SizeChoices key={String(size)} value={size} defaultHint={worded.every((i) => i.kind === 'text') ? undefined : t('fontSize.defaultItem')} onPick={actions.size} />
          )}
          {panel === 'text' && head && (
            <div className="flex items-center gap-0.5">
              {LOOKS.map(({ look, Icon }) => {
                return (
                  <Btn key={look} label={t(`context.look.${look}`)} pressed={lookOn(head, look)} onClick={() => actions.look(look)}>
                    <Icon className="h-4 w-4" />
                  </Btn>
                )
              })}
              <span className="mx-0.5 h-6 w-px bg-ink-700" />
              {ALIGN.map(({ align, Icon }) => (
                <Btn key={align} label={t(`context.align.${align}`)} pressed={alignOf(head) === align} onClick={() => actions.change((x) => (x.kind !== 'line' && hasWords(x) ? { ...x, align } : x))}>
                  <Icon className="h-4 w-4" />
                </Btn>
              ))}
            </div>
          )}
          {panel === 'arrange' && (
            <div className="grid grid-cols-4 gap-1">
              {ARRANGE.map(({ how, Icon }) => (
                <button key={how} type="button" className="nc-tool h-8 w-8" title={t(`arrange.${how}`)} aria-label={t(`arrange.${how}`)} onClick={() => actions.arrange(how)}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          )}
          {panel === 'shape' && (
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map(({ kind, Icon }) => (
                <button key={kind} type="button" className="nc-tool h-8 w-8" aria-pressed={first?.kind === 'shape' && first.shape === kind && !first.lib} title={t(`shapes.${kind}`)} aria-label={t(`shapes.${kind}`)} onClick={() => actions.change((x) => (x.kind === 'shape' ? { ...x, shape: kind, lib: undefined } : x))}>
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

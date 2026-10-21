/**
 * The bar above the words someone writes in: bold, italic, underlined, struck through, a colour and a size for what is
 * marked, a bullet or numbered list for its lines, and the alignment of all the words. Pressing a button never takes
 * the caret out of the words (`mousedown` does nothing), so writing goes on right away.
 */

import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PALETTE } from '../palette'
import { pxOf, type ListKind, type SpanLook } from '../rich'
import { alignOf, baseOf, type Worded } from '../textLook'
import type { TextAlign, TextLook } from '../types'
import type { OpenEditor } from './PdfPage'
import { toggleLook } from './quill'
import { SizeChoices, SizeLabel } from './SizePicker'

const LOOKS: { look: SpanLook; Icon: typeof Bold }[] = [
  { look: 'bold', Icon: Bold },
  { look: 'italic', Icon: Italic },
  { look: 'underline', Icon: Underline },
  { look: 'strike', Icon: Strikethrough },
]
const LISTS: { list: ListKind; Icon: typeof List }[] = [
  { list: 'bullet', Icon: List },
  { list: 'ordered', Icon: ListOrdered },
]
const ALIGN: { align: TextAlign; Icon: typeof AlignLeft }[] = [
  { align: 'left', Icon: AlignLeft },
  { align: 'center', Icon: AlignCenter },
  { align: 'right', Icon: AlignRight },
]
/** Colours for a part of the words: the palette without the mode's own, which is what no colour shows. */
const COLORS = PALETTE.filter((c) => c !== 'auto')

function Btn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="nc-tool h-8 w-8" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

export function TextBar({ editor, item, at, docked = false, setBase, setAlign }: {
  editor: OpenEditor
  item: Worded
  at: { x: number; y: number }
  docked?: boolean
  setBase: (change: Partial<TextLook>) => void
  setAlign: (align: TextAlign) => void
}) {
  const { t } = useTranslation()
  const { quill } = editor
  const [formats, setFormats] = useState<Record<string, unknown>>(() => quill.getFormat())
  const [panel, setPanel] = useState<'color' | 'size' | null>(null)

  useEffect(() => {
    const changed = () => setFormats(quill.getSelection() ? quill.getFormat() : {})
    changed()
    quill.on('editor-change', changed)
    return () => {
      quill.off('editor-change', changed)
    }
  }, [quill])

  const format = (name: string, value: unknown) => {
    const range = quill.getSelection(true)
    if (name !== 'list' && range.length) quill.formatText(range.index, range.length, name, value, 'user')
    else quill.format(name, value, 'user')
    setFormats(quill.getFormat())
  }
  const color = typeof formats.color === 'string' ? formats.color : null
  const size = pxOf(formats.size)

  return (
    <div
      data-textbar
      className={'pointer-events-auto absolute z-30 -translate-x-1/2 ' + (docked ? 'max-w-[calc(100vw-16px)]' : '-translate-y-full')}
      style={docked ? { left: '50%', bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 52px)' } : { left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={'nc-float flex items-center gap-0.5 p-1 ' + (docked ? 'nc-scroll overflow-x-auto' : '')}>
        {LOOKS.map(({ look, Icon }) => (
          <Btn
            key={look}
            label={t(`context.look.${look}`)}
            pressed={formats[look] === true || baseOf(item, look)}
            onClick={() => {
              toggleLook(quill, item, look, setBase)
              setFormats(quill.getFormat())
            }}
          >
            <Icon className="h-4 w-4" />
          </Btn>
        ))}
        <span className="mx-0.5 h-6 w-px bg-ink-700" />
        <Btn label={t('textBar.color')} pressed={panel === 'color'} onClick={() => setPanel(panel === 'color' ? null : 'color')}>
          <span className="flex h-4 w-4 flex-col items-center justify-end text-xs leading-none font-bold">
            A
            <span className="mt-px h-1 w-4 rounded-sm" style={{ background: color ?? 'currentColor' }} />
          </span>
        </Btn>
        <Btn label={t('textBar.size')} pressed={panel === 'size'} onClick={() => setPanel(panel === 'size' ? null : 'size')}>
          <SizeLabel value={size} />
        </Btn>
        <span className="mx-0.5 h-6 w-px bg-ink-700" />
        {LISTS.map(({ list, Icon }) => (
          <Btn key={list} label={t(`textBar.list.${list}`)} pressed={formats.list === list} onClick={() => format('list', formats.list === list ? false : list)}>
            <Icon className="h-4 w-4" />
          </Btn>
        ))}
        <span className="mx-0.5 h-6 w-px bg-ink-700" />
        {ALIGN.map(({ align, Icon }) => (
          <Btn key={align} label={t(`context.align.${align}`)} pressed={alignOf(item) === align} onClick={() => setAlign(align)}>
            <Icon className="h-4 w-4" />
          </Btn>
        ))}
      </div>
      {panel && (
        <div className={'nc-float absolute left-1/2 w-max max-w-72 -translate-x-1/2 p-2.5 ' + (docked ? 'bottom-full mb-2' : 'top-full mt-2')}>
          {panel === 'color' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label={t('textBar.noColor')}
                title={t('textBar.noColor')}
                aria-pressed={!color}
                onClick={() => format('color', false)}
                className={'grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-mist-100 ring-offset-2 ring-offset-ink-850 ' + (!color ? 'ring-2 ring-accent-500' : 'ring-1 ring-ink-600')}
              >
                A
              </button>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  title={c}
                  aria-pressed={color === c}
                  onClick={() => format('color', c)}
                  className={'h-6 w-6 rounded-full ring-offset-2 ring-offset-ink-850 ' + (color === c ? 'ring-2 ring-accent-500' : 'ring-1 ring-ink-600')}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
          {panel === 'size' && (
            <SizeChoices key={String(size)} value={size} defaultHint={t('fontSize.defaultPart')} onPick={(n) => format('size', n === null ? false : `${n}px`)} />
          )}
        </div>
      )}
    </div>
  )
}

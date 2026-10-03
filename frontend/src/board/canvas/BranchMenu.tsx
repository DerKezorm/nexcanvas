import { Copy, StickyNote, Type } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { choiceFromKey, choiceKey, type BranchChoice } from '../branch'
import type { Point } from '../geometry'
import type { Item } from '../types'
import { SHAPES } from './Toolbar'

const RECENT_KEY = 'nexcanvas.branchRecent'

/** The last choices, newest first; kept in this browser, a convenience only. */
// eslint-disable-next-line react-refresh/only-export-components
export function recentChoices(): BranchChoice[] {
  try {
    const keys = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    return keys.map(choiceFromKey).filter((c): c is BranchChoice => c !== null)
  } catch {
    return []
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function rememberChoice(choice: BranchChoice): void {
  if (choice.kind === 'same') return
  try {
    const key = choiceKey(choice)
    const keys = [key, ...recentChoices().map(choiceKey).filter((k) => k !== key)].slice(0, 4)
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys))
  } catch {
    // Without storage the menu simply has no recent row.
  }
}

/**
 * What the "+" beside an item adds, as Freeform's and Visio's quick shapes: the same again, a note, a text, the
 * shapes; the ones taken last stand first. Opens where the "+" was, closes on Escape or a click elsewhere.
 */
export function BranchMenu({ at, from, onPick, onClose }: { at: Point; from: Item; onPick: (choice: BranchChoice) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const same = from.kind === 'note' || from.kind === 'shape' || from.kind === 'text'
  const recent = recentChoices()
  const cell = 'grid h-10 w-10 place-items-center rounded-xl text-mist-300 hover:bg-ink-800 hover:text-mist-100 focus-visible:bg-ink-800'
  const label = (choice: BranchChoice) => (choice.kind === 'shape' ? t(`shapes.${choice.shape}`) : t(`canvas.branch.${choice.kind}`))
  const icon = (choice: BranchChoice) => {
    if (choice.kind === 'note') return <StickyNote className="h-5 w-5" strokeWidth={1.7} />
    if (choice.kind === 'text') return <Type className="h-5 w-5" strokeWidth={1.7} />
    if (choice.kind === 'same') return <Copy className="h-5 w-5" strokeWidth={1.7} />
    const Icon = SHAPES.find((s) => s.kind === choice.shape)?.Icon ?? Copy
    return <Icon className="h-5 w-5" strokeWidth={1.7} />
  }
  const button = (choice: BranchChoice) => (
    <button key={choiceKey(choice)} type="button" role="menuitem" className={cell} title={label(choice)} aria-label={label(choice)} onClick={() => onPick(choice)}>
      {icon(choice)}
    </button>
  )

  return (
    <div
      ref={box}
      data-ui
      role="menu"
      aria-label={t('canvas.branch.title')}
      data-testid="branch-menu"
      className="nc-float absolute z-30 w-[188px] -translate-x-1/2 p-2"
      style={{ left: at.x, top: at.y + 16 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t('canvas.branch.title')}</p>
      <div className="grid grid-cols-4 gap-0.5">
        {same && button({ kind: 'same' })}
        {button({ kind: 'note' })}
        {button({ kind: 'text' })}
      </div>
      {recent.length > 0 && (
        <>
          <p className="px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t('canvas.branch.recent')}</p>
          <div className="grid grid-cols-4 gap-0.5">{recent.map(button)}</div>
        </>
      )}
      <p className="px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{t('canvas.branch.shapes')}</p>
      <div className="grid grid-cols-4 gap-0.5">{SHAPES.map(({ kind }) => button({ kind: 'shape', shape: kind }))}</div>
      <p className="px-1 pt-2 text-[11px] leading-snug text-mist-600">{t('canvas.branch.hint')}</p>
    </div>
  )
}

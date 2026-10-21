/**
 * Picking a text size, the same for all the words of an item (the bar above a selection) and for what is marked while
 * writing (the bar above the words): the sizes offered in pixels, any whole number typed in, and the default.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FONT_MAX, FONT_MIN, FONT_SIZES, fontSize } from '../rich'

/** What the button that opens the choice shows: the size there is now, or two letters for the default. */
export function SizeLabel({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-xs font-semibold">
        A<span className="text-[9px]">A</span>
      </span>
    )
  }
  return <span className="text-xs font-semibold tabular-nums">{value}</span>
}

export function SizeChoices({ value, defaultHint, onPick }: {
  value: number | null
  /** What the default means here; without it there is none to go back to. */
  defaultHint?: string
  onPick: (size: number | null) => void
}) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState(value === null ? '' : String(value))
  const take = () => {
    const n = Number(typed.replace(',', '.'))
    if (typed.trim() && Number.isFinite(n)) onPick(fontSize(n))
  }
  return (
    <div className="flex w-64 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={FONT_MIN}
          max={FONT_MAX}
          step={1}
          value={typed}
          placeholder={value === null ? t('fontSize.default') : undefined}
          aria-label={t('fontSize.pixels')}
          title={t('fontSize.pixels')}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') take()
          }}
          className="nc-field h-8 w-20 py-1 tabular-nums"
        />
        <span className="text-xs text-mist-500">px</span>
        {defaultHint && (
          <button
            type="button"
            aria-pressed={value === null}
            title={defaultHint}
            onClick={() => onPick(null)}
            className={'ml-auto h-8 rounded-lg px-2 text-xs font-semibold ' + (value === null ? 'bg-accent-500/15 text-accent-400' : 'text-mist-400 hover:bg-ink-800')}
          >
            {t('fontSize.default')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {FONT_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => {
              setTyped(String(n))
              onPick(n)
            }}
            className={'h-8 rounded-lg text-xs font-semibold tabular-nums ' + (value === n ? 'bg-accent-500/15 text-accent-400' : 'text-mist-400 hover:bg-ink-800')}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

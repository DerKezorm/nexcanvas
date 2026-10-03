import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '../../components/Dialog'
import { backgroundStyle, baseColor, COLORS, PATTERNS } from '../background'
import type { Background } from '../types'

/**
 * The board's background, from the board's menu: the pattern (nothing, dots, squares, lines, millimetres, triangle
 * dots) and the colour (following light and dark, or a fixed paper). It changes at once for everybody on the board;
 * "as my default" hands the board back to each person's own setting.
 */
export function BackgroundDialog({ own, shown, onChange, onClose }: { own: Background | undefined; shown: Background; onChange: (next: Background | null) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const tile = (active: boolean) =>
    'relative h-16 overflow-hidden rounded-xl border-2 transition ' + (active ? 'border-accent-500' : 'border-ink-700 hover:border-ink-600')
  const custom = !(shown.color in COLORS)
  return (
    <Dialog title={t('background.title')} onClose={onClose}>
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-mist-500">{t('background.pattern')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {PATTERNS.map((pattern) => (
              <button
                key={pattern}
                type="button"
                aria-pressed={shown.pattern === pattern}
                data-pattern={pattern}
                onClick={() => onChange({ ...shown, pattern })}
                className="text-left"
              >
                <span className={tile(shown.pattern === pattern) + ' block'} style={backgroundStyle({ ...shown, pattern }, { x: 4, y: 4, zoom: 0.75 }, true)} />
                <span className="mt-1 block text-xs text-mist-300">{t(`background.patterns.${pattern}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-mist-500">{t('background.color')}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {Object.keys(COLORS).map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={shown.color === color}
                data-color={color}
                title={t(`background.colors.${color}`)}
                aria-label={t(`background.colors.${color}`)}
                onClick={() => onChange({ ...shown, color })}
                className={'grid h-9 w-9 place-items-center rounded-full border-2 ' + (shown.color === color ? 'border-accent-500' : 'border-ink-700')}
                style={{ background: baseColor(color) || 'var(--color-board)' }}
              >
                {shown.color === color && <Check className="h-4 w-4 text-accent-500" strokeWidth={3} />}
              </button>
            ))}
            <label className={'flex h-9 items-center gap-2 rounded-full border-2 px-3 text-xs text-mist-300 ' + (custom ? 'border-accent-500' : 'border-ink-700')}>
              <input type="color" value={baseColor(shown.color) || '#ffffff'} onChange={(e) => onChange({ ...shown, color: e.target.value.toLowerCase() })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label={t('background.custom')} />
              {t('background.custom')}
            </label>
          </div>
          <p className="mt-2 text-xs text-mist-500">{t('background.colorHint')}</p>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-4">
          <button type="button" className="nc-btn nc-btn-ghost" disabled={!own} onClick={() => onChange(null)}>
            {t('background.default')}
          </button>
          <button type="button" className="nc-btn nc-btn-accent" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
        <p className="text-xs text-mist-500">{t('background.everyone')}</p>
      </div>
    </Dialog>
  )
}

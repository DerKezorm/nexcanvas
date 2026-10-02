import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/client'
import { errorText } from '../lib/errors'
import { Dialog } from './Dialog'

/** The colours a space may have; the server takes these and no others. */
// eslint-disable-next-line react-refresh/only-export-components
export const SPACE_COLORS = ['#ff8a70', '#fbbf24', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#a1a1aa']

/** A new space: a name and a colour. The account that makes it manages it and invites others. */
export function NewSpaceDialog({ onClose, onCreate, initial }: {
  onClose: () => void
  onCreate: (name: string, color: string) => Promise<void>
  initial?: { name: string; color: string; title: string }
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? SPACE_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Dialog title={initial?.title ?? t('sidebar.newSpace')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return setProblem('invalid_name')
          setBusy(true)
          setProblem(null)
          try {
            await onCreate(name.trim(), color)
          } catch (error) {
            setProblem(error instanceof ApiError ? error.code : 'internal_error')
            setBusy(false)
          }
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mist-500">{t('space.name')}</span>
          <input className="nc-field" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('space.placeholder')} />
        </label>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-mist-500">{t('space.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {SPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={'h-7 w-7 rounded-full ring-offset-2 ring-offset-ink-900 ' + (color === c ? 'ring-2 ring-accent-500' : '')}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-mist-600">{t('space.hint')}</p>
        {problem && <p className="text-sm text-bad-500">{errorText(problem)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent" disabled={busy}>
            {initial ? t('common.save') : t('space.create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

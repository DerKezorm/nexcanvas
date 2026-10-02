/** Building blocks of the settings and account pages, as nexlore's: cards, rows, switches, a feedback line. */
import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../../api/client'
import { Dialog } from '../../components/Dialog'
import { errorText } from '../../lib/errors'

export function Card({ title, text, children, id }: { title: string; text?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <h2 className="text-base font-semibold text-mist-100">{title}</h2>
      {text && <p className="mt-1 text-sm text-mist-500">{text}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid items-start gap-2 text-sm sm:grid-cols-[220px_1fr]">
      <span className="pt-2 text-mist-400">{label}</span>
      <div>
        {children}
        {hint && <p className="mt-1 text-xs text-mist-600">{hint}</p>}
      </div>
    </div>
  )
}

export function Switch({ label, on, onChange, disabled = false, hint }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div>
        <span className="text-mist-200">{label}</span>
        {hint && <p className="mt-0.5 text-xs text-mist-600">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ' + (on ? 'bg-accent-500' : 'bg-ink-600')}
      >
        <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  )
}

export function Button({ children, onClick, busy = false, accent = false, danger = false, type = 'button', disabled = false }: {
  children: ReactNode
  onClick?: () => void
  busy?: boolean
  accent?: boolean
  danger?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  const look = danger ? 'border border-bad-500/50 text-bad-500 hover:bg-bad-500/10' : accent ? 'nc-btn-accent' : 'nc-btn-ghost'
  return (
    <button type={type} onClick={onClick} disabled={busy || disabled} className={'nc-btn ' + look}>
      {children}
    </button>
  )
}

/** One line under a card: what went wrong, or that it worked. */
export function Feedback({ problem, done }: { problem: string | null; done: string | null }) {
  if (problem) return <p role="alert" className="text-sm text-bad-500">{errorText(problem)}</p>
  if (done) return <p role="status" className="text-sm text-ok-500">{done}</p>
  return null
}

/** Runs a change, remembers whether it worked; the card shows it with `Feedback`. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = useCallback(async (work: () => Promise<void>, success?: string) => {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      await work()
      if (success) setDone(success)
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'internal_error')
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, problem, done, run }
}

/** "Really?" with the operator's password where the server asks for it again. */
export function Confirm({ title, text, confirm, danger = false, password = false, onCancel, onConfirm }: {
  title: string
  text: string
  confirm: string
  danger?: boolean
  password?: boolean
  onCancel: () => void
  onConfirm: (password: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const { busy, problem, run } = useAction()
  return (
    <Dialog title={title} onClose={onCancel}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => onConfirm(value))
        }}
      >
        <p className="text-sm text-mist-300">{text}</p>
        {password && <input className="nc-field" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('settings.ownPassword')} autoComplete="current-password" autoFocus />}
        <Feedback problem={problem} done={null} />
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className={'nc-btn ' + (danger ? 'bg-bad-500 text-white hover:opacity-90' : 'nc-btn-accent')}>
            {confirm}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function TabRow({ tabs, value, onChange, small = false }: { tabs: [string, string][]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div className={'flex gap-1 overflow-x-auto ' + (small ? '' : 'border-b border-ink-700/80')} role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={
            small
              ? 'shrink-0 rounded-full px-3 py-1 text-xs font-medium ' + (value === id ? 'bg-accent-500/15 text-accent-400' : 'text-mist-500 hover:bg-ink-850 hover:text-mist-100')
              : 'shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium ' + (value === id ? 'border-accent-500 text-mist-100' : 'border-transparent text-mist-500 hover:text-mist-100')
          }
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function saveAsFile(name: string, data: Blob) {
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

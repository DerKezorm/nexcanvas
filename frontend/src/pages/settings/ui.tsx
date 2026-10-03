/**
 * Building blocks of the settings, account and about pages, the same as nexlore's (components/settings/ui.tsx and
 * components/TabRow.tsx): whoever knows one app finds the same card, row, field and tab in the other.
 */
import type { LucideIcon } from 'lucide-react'
import { useCallback, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../../api/client'
import { Dialog } from '../../components/Dialog'
import { errorText } from '../../lib/errors'

/** A card with its symbol in a small box, a title and a line of explanation. */
export function Card({ icon: Icon, title, text, children, id }: { icon: LucideIcon; title: string; text?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
      <div className="mb-4 flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-500/12 text-accent-400">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </span>
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="font-semibold text-mist-100">
            {title}
          </h2>
          {text && <p className="text-sm text-mist-500">{text}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** A heading inside a card, for a second part of it (as nexlore's "OpenID Connect" under "Sign-in"). */
export function SubHead({ title, text }: { title: string; text?: string }) {
  return (
    <div className="pt-3">
      <h3 className="text-sm font-semibold text-mist-100">{title}</h3>
      {text && <p className="text-xs text-mist-500">{text}</p>}
    </div>
  )
}

/** A switch with its name and a line of explanation; the whole row is the label (a checkbox, as in nexlore). */
export function Toggle({ label, hint, checked, onChange, disabled = false }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const hintId = useId()
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
      <span>
        <span className="font-medium text-mist-100">{label}</span>
        {hint && (
          <span id={hintId} className="block text-xs text-mist-500">
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-accent-500"
      />
    </label>
  )
}

/** A field with its name above it and an optional line below. */
export function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  className = '',
  autoComplete = 'off',
  min,
  max,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  hint?: string
  className?: string
  autoComplete?: string
  min?: number
  max?: number
}) {
  const hintId = useId()
  return (
    <div className={'text-sm ' + className}>
      <label className="block">
        <span className="text-xs font-medium text-mist-400">{label}</span>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          min={min}
          max={max}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
        />
      </label>
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-mist-500">
          {hint}
        </span>
      )}
    </div>
  )
}

export function Select<T extends string>({ label, value, options, onChange, className = '' }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <label className={'block text-sm ' + className}>
      <span className="text-xs font-medium text-mist-400">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-2 text-sm text-mist-100">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Button({
  children,
  onClick,
  busy = false,
  accent = false,
  danger = false,
  small = false,
  type = 'button',
  disabled = false,
  label,
}: {
  children: ReactNode
  onClick?: () => void
  busy?: boolean
  accent?: boolean
  danger?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  label?: string
}) {
  const look = accent
    ? 'bg-accent-500 font-semibold text-on-accent hover:bg-accent-400'
    : danger
      ? 'border border-ink-700 text-mist-300 hover:border-bad-500/50 hover:text-bad-500'
      : 'border border-ink-700 text-mist-300 hover:bg-ink-850'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-full ${small ? 'px-2.5 py-0.5 text-xs' : 'px-3.5 py-1.5 text-sm'} ${look} disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

/** One line under a card: what went wrong, or that it worked. */
export function Feedback({ problem, done = null }: { problem: string | null; done?: string | null }) {
  return (
    <div aria-live="polite">
      {problem && (
        <p role="alert" className="text-sm text-bad-500">
          {errorText(problem)}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-ok-500">
          {done}
        </p>
      )}
    </div>
  )
}

/** A link or value to copy: the field and the button that copies it. */
export function CopyLink({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-xl border border-accent-500/40 bg-accent-500/10 p-2">
      <input readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-mist-100 outline-none" />
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
        className="shrink-0 rounded-full bg-accent-500 px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent-400"
      >
        {copied ? '✓' : t('common.copy')}
      </button>
    </div>
  )
}

/** Runs a change, remembers whether it worked; the card shows it with `Feedback`. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = useCallback(async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      await work()
      if (success) setDone(success)
      return true
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'internal_error')
      return false
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
        <Feedback problem={problem} />
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

export type Tab<T extends string> = { value: T; label: string; icon?: LucideIcon }

/**
 * A row of round tabs, as in nexlore. `under`: a second row below the first, tied to it by a line on the left. The
 * row wraps on a narrow screen.
 */
export function TabRow<T extends string>({ tabs, active, onChange, under = false, label }: { tabs: Tab<T>[]; active: T; onChange: (value: T) => void; under?: boolean; label?: string }) {
  return (
    <div className={'flex flex-wrap items-center gap-2 ' + (under ? 'border-l-2 border-accent-500/40 pl-4' : '')} role="tablist" aria-label={label}>
      {tabs.map(({ value, label: name, icon: Icon }) => {
        const selected = active === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(value)}
            className={
              'inline-flex items-center gap-2 rounded-full border text-sm font-medium transition-colors ' +
              (under ? 'px-3.5 py-1.5 ' : 'px-4 py-2 ') +
              (selected ? 'border-accent-500/60 bg-accent-500/15 text-accent-400' : 'border-ink-700 bg-ink-900 text-mist-500 hover:text-mist-100')
            }
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
            {name}
          </button>
        )
      })}
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

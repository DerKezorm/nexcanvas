/** A field with its name above it, and a problem as a red box: the pieces of the account page, as in nexlore. */
import { useId } from 'react'

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  autoFocus = false,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  hint?: string
}) {
  // The hint describes the field; it is not part of its name.
  const hintId = useId()
  return (
    <div className="text-sm">
      <label className="block">
        <span className="font-medium text-mist-100">{label}</span>
        <input
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none focus:border-accent-500"
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

export function Problem({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="rounded-lg border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
      {text}
    </p>
  )
}

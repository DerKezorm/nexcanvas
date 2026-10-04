import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** A dialog over the page: Escape and the scrim close it, focus starts inside and comes back afterwards. */
export function Dialog({ title, onClose, children, wide = false, medium = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; medium?: boolean }) {
  const { t } = useTranslation()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')
    first?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      before?.focus?.()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={'flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/50 ' + (wide ? 'max-w-2xl' : medium ? 'max-w-xl' : 'max-w-md')}>
        <div className="flex shrink-0 items-center justify-between border-b border-ink-700/70 px-5 py-3.5">
          <h2 className="text-base font-semibold text-mist-100">{title}</h2>
          <button type="button" data-close onClick={onClose} aria-label={t('common.close')} className="rounded-full p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Taller than the screen (the connect assistant of a firm with many accounts, a long form on a phone): the
            inside scrolls, the title stays. */}
        <div className="nc-scroll min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

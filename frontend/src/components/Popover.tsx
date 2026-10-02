import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A button with a menu under it. Closes on a click elsewhere, on Escape and after choosing (items call `close`).
 */
export function Popover({
  button,
  label,
  children,
  align = 'right',
  className = '',
  up = false,
}: {
  button: ReactNode
  label: string
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
  up?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} title={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} className={className}>
        {button}
      </button>
      {open && (
        <div role="menu" className={'nc-menu absolute ' + (up ? 'bottom-full mb-2 ' : 'top-full mt-2 ') + (align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

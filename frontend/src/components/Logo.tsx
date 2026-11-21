import { useId } from 'react'

/**
 * nexcanvas mark: an easel with a canvas, a sun and hills on it as the accent.
 *
 * The source of every version is nexapps/icons-vergleich/neu.py; the same shape is in public/logo.svg (favicon). The
 * colours come from --nc-logo-* in styles/index.css and follow the theme: a dark tile in dark mode, a white one in
 * light mode.
 */
export function Logo({ className = 'h-8 w-8', withWordmark = false }: { className?: string; withWordmark?: boolean }) {
  // One id per mark: a gradient whose first copy sits in a hidden part of the page draws nothing for the others.
  const id = `nc-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const line = `url(#${id})`
  const accent = 'var(--nc-logo-accent)'
  const mark = (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        {/* userSpaceOnUse, so the gradient runs across the whole mark instead of restarting for each stroke. */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="54" y2="54">
          <stop offset="0" style={{ stopColor: 'var(--nc-logo-gradient-1)' }} />
          <stop offset=".5" style={{ stopColor: 'var(--nc-logo-gradient-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--nc-logo-gradient-3)' }} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" style={{ fill: 'var(--nc-logo-ground)' }} />
      <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="15.3" fill="none" strokeWidth="1.5" style={{ stroke: 'var(--nc-logo-rim)' }} />
      {/* the easel's legs, the canvas and its ledge */}
      <path d="M22 38 17 53M42 38 47 53M32 38V50" stroke={line} strokeWidth="3.6" strokeLinecap="round" />
      <rect x="15" y="11.5" width="34" height="25.5" rx="2.5" stroke={line} strokeWidth="4.2" style={{ fill: 'var(--nc-logo-ground)' }} />
      <path d="M12.5 38h39" stroke={line} strokeWidth="4.2" strokeLinecap="round" />
      {/* the picture: a sun and hills */}
      <circle cx="24.5" cy="20.5" r="3.4" style={{ fill: accent }} />
      <path d="M20 32.5l7.5-7 5 4.5 4-4.5 7.5 7" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: accent }} />
    </svg>
  )
  if (!withWordmark) return mark
  return (
    <span className="flex items-center gap-2.5">
      {mark}
      <span className="hidden text-lg font-bold tracking-tight sm:inline">
        NEX<span className="text-accent-500">CANVAS</span>
      </span>
    </span>
  )
}

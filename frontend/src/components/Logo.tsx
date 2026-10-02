/** nexcanvas mark: circle, square and triangle on a board, in coral, within the style of the nexapps marks. */
export function Logo({ className = 'h-8 w-8', withWordmark = false }: { className?: string; withWordmark?: boolean }) {
  // userSpaceOnUse, so the gradient runs across the whole mark instead of restarting for each stroke.
  const mark = (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nexcanvas-mark" gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="56" y2="56">
          <stop offset="0" stopColor="#ffe4dc" />
          <stop offset=".5" stopColor="#ff8a70" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#170d0a" />
      <rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke="url(#nexcanvas-mark)" strokeWidth="2.5" strokeOpacity=".55" />
      <circle cx="22" cy="23" r="8.5" fill="none" stroke="url(#nexcanvas-mark)" strokeWidth="4.5" />
      <rect x="36" y="15.5" width="15" height="15" rx="3" fill="none" stroke="url(#nexcanvas-mark)" strokeWidth="4.5" />
      <path d="M32 36.5 43 50H21Z" fill="none" stroke="#ff8a70" strokeWidth="4.5" strokeLinejoin="round" />
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

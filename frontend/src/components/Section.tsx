import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** A part of the account page: its symbol and title in one line, as nexlore's. */
export function Section({ icon: Icon, title, children, id }: { icon: LucideIcon; title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-mist-100">
        <Icon className="h-4 w-4 text-accent-400" strokeWidth={1.8} aria-hidden /> {title}
      </h2>
      {children}
    </section>
  )
}

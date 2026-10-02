import { PEOPLE } from '../board/demo'

/** A person as a round letter, as nexlore shows accounts without a picture. */
export function Avatar({ person, className = 'h-8 w-8 text-sm', ring = false }: { person: string; className?: string; ring?: boolean }) {
  const p = PEOPLE.find((x) => x.id === person)
  const letter = (p?.name ?? '?').slice(0, 1)
  return (
    <span
      title={p?.name}
      className={'grid shrink-0 place-items-center rounded-full font-semibold ' + (ring ? 'ring-2 ring-ink-950 ' : '') + className}
      style={{ background: `color-mix(in srgb, ${p?.color ?? '#888'} 22%, var(--color-ink-850))`, color: p?.color }}
    >
      {letter}
    </span>
  )
}

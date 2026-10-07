import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { Item, View } from '../types'
import type { Peer } from './useLiveDoc'

/** The colours people get, by their name. */
// eslint-disable-next-line react-refresh/only-export-components
export const COLORS = ['#60a5fa', '#f472b6', '#4ade80', '#fbbf24', '#a78bfa', '#2dd4bf', '#fb923c', '#f87171']

/** Everyone gets a colour of their own, the same in every browser: it comes from the name. */
// eslint-disable-next-line react-refresh/only-export-components
export function personColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

/** Who else has the board open right now, as small round letters in the head of the board. */
export function Peers({ peers }: { peers: Peer[] }) {
  const { t } = useTranslation()
  // The same person in two tabs is one face.
  const people = [...new Map(peers.map((peer) => [peer.name, peer])).values()]
  if (people.length === 0) return null
  return (
    <span className="hidden items-center sm:flex" title={t('board.hereNow')} aria-label={t('board.hereNow')}>
      <span className="flex -space-x-1.5">
        {people.slice(0, 5).map((peer) => (
          <span
            key={peer.client}
            title={peer.name}
            className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ring-2 ring-ink-950"
            style={{ background: peer.color, color: '#111' }}
          >
            {initial(peer.name)}
          </span>
        ))}
      </span>
      {people.length > 5 && <span className="ml-1.5 text-xs text-mist-500">+{people.length - 5}</span>}
    </span>
  )
}

/** The pointers of the others on the board, with their names; and a frame in their colour around what they hold. */
export const PeerPointers = memo(function PeerPointers({ peers, view, items }: { peers: Peer[]; view: View; items: Map<string, Item> }) {
  return (
    <>
      {peers.map((peer) => {
        const held = [...(peer.selection ?? []), ...(peer.editing ? [peer.editing] : [])]
        return held.map((id) => {
          const item = items.get(id)
          if (!item) return null
          return (
            <div
              key={`${peer.client}-${id}`}
              className="pointer-events-none absolute rounded-sm border-2"
              style={{ left: item.x * view.zoom + view.x - 3, top: item.y * view.zoom + view.y - 3, width: item.w * view.zoom + 6, height: item.h * view.zoom + 6, borderColor: peer.color }}
            />
          )
        })
      })}
      {peers.map((peer) =>
        peer.pointer ? (
          <div
            key={peer.client}
            className="pointer-events-none absolute z-20 transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${peer.pointer.x * view.zoom + view.x}px, ${peer.pointer.y * view.zoom + view.y}px)`, left: 0, top: 0 }}
          >
            <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))' }}>
              <path d="M1 1v15l4.2-3.8 2.9 6.3 2.7-1.3-2.9-6.2H14Z" fill={peer.color} stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span className="ml-3 -mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap shadow" style={{ background: peer.color, color: '#111' }}>
              {peer.name}
            </span>
          </div>
        ) : null,
      )}
    </>
  )
})

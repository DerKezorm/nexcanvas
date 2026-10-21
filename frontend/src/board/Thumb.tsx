import { bounds, lineGeometry, shapePath } from './geometry'
import { NOTE_COLORS, paint } from './palette'
import { OUTLINE_WEIGHT, outlineOf, type Board, type Item } from './types'
import { backgroundStyle, effectiveBackground, inkVariables } from './background'
import { LibShape } from './library/LibShape'
import { makeLookup, outlineFor, type Lookup } from './library/registry'
import { inkPath } from './ink'
import { drawOrder } from './order'
import { mediaUrl } from '../api/client'
import { shownOf } from './hiding'

/** A small picture of a board for the overview: the same items, simplified, fitted into the card. */
export function Thumb({ board: whole }: { board: Board }) {
  // What lies in a hidden frame stays covered here too, as on the board.
  const board = { ...whole, ...shownOf(whole) }
  // The board's own background, small; without one, the dots of the overview.
  const shown = effectiveBackground(board.background, true)
  const look = backgroundStyle(shown, { x: 0, y: 0, zoom: 14 / 24 })
  const box = bounds(board.items)
  // An empty board is its background, nothing on it.
  if (!box) return <div className="nc-board h-full w-full" style={look} data-empty />

  const pad = Math.max(box.w, box.h) * 0.06 + 20
  const view = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`
  const items = new Map(board.items.map((i) => [i.id, i]))
  const lookup = makeLookup([], board.defs)
  return (
    <svg viewBox={view} preserveAspectRatio="xMidYMid meet" className="nc-board h-full w-full" style={{ ...look, ...inkVariables(shown) }} aria-hidden="true" data-pattern={shown.pattern}>
      {drawOrder(board.items).map((item) =>
        item.rot ? (
          <g key={item.id} transform={`rotate(${item.rot} ${item.x + item.w / 2} ${item.y + item.h / 2})`}>
            <ThumbItem item={item} lookup={lookup} />
          </g>
        ) : (
          <ThumbItem key={item.id} item={item} lookup={lookup} />
        ),
      )}
      {board.lines.map((line) => (
        <path key={line.id} d={lineGeometry(line, items, outlineFor(lookup)).d} fill="none" stroke={paint(line.color)} strokeWidth={line.width * 1.5} strokeDasharray={line.dashed ? '8 6' : undefined} />
      ))}
    </svg>
  )
}

function ThumbItem({ item, lookup }: { item: Item; lookup: Lookup }) {
  switch (item.kind) {
    case 'note':
      return <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={6} fill={NOTE_COLORS[item.color]} />
    case 'shape': {
      const def = item.lib ? lookup(item.lib) : undefined
      if (def) return <LibShape def={def} x={item.x} y={item.y} w={item.w} h={item.h} colors={{ fill: item.fill, line: item.stroke }} weight={outlineOf(item) / OUTLINE_WEIGHT} className="" interactive={false} />
      return (
        <path
          transform={`translate(${item.x} ${item.y})`}
          d={shapePath(item.shape, item.w, item.h)}
          fill={paint(item.fill)}
          stroke={item.stroke === 'none' ? 'none' : paint(item.stroke)}
          strokeWidth={(outlineOf(item) * 3) / OUTLINE_WEIGHT}
        />
      )
    }
    case 'text': {
      const bar = Math.min(item.w, item.text.length * (item.size === 'xl' ? 22 : 12))
      const shift = item.align === 'center' ? (item.w - bar) / 2 : item.align === 'right' ? item.w - bar : 0
      return <rect x={item.x + shift} y={item.y + item.h * 0.3} width={bar} height={item.h * 0.4} rx={4} fill="var(--color-mist-500)" opacity={0.6} />
    }
    case 'image':
      return <image href={mediaUrl(item.media, true)} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="xMidYMid slice" />
    case 'frame':
      return <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={14} fill="var(--color-ink-800)" opacity={0.6} stroke={item.color} strokeWidth={3} />
    case 'file':
    case 'link':
    case 'timer':
      return <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={10} fill="var(--color-ink-800)" stroke="var(--color-ink-600)" strokeWidth={2} />
    case 'ink':
      return (
        <g transform={`translate(${item.x} ${item.y}) scale(${item.w / item.ow} ${item.h / item.oh})`}>
          <path d={inkPath(item)} fill={paint(item.color)} opacity={item.marker ? 0.45 : 1} />
        </g>
      )
  }
}

import { memo } from 'react'

import { arrowAngle, lineGeometry, type Point } from '../geometry'
import { paint } from '../palette'
import type { Item, LineItem } from '../types'

function head(tip: Point, from: Point, size: number): string {
  const a = arrowAngle(tip, from)
  const l = { x: tip.x - Math.cos(a - 0.45) * size, y: tip.y - Math.sin(a - 0.45) * size }
  const r = { x: tip.x - Math.cos(a + 0.45) * size, y: tip.y - Math.sin(a + 0.45) * size }
  return `M${tip.x} ${tip.y}L${l.x} ${l.y}L${r.x} ${r.y}Z`
}

/** All lines of the board in one SVG at the board origin; each answers to the pointer along its path. */
export const Lines = memo(function Lines({ lines, items, selected }: { lines: LineItem[]; items: Item[]; selected: Set<string> }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  return (
    <svg className="absolute top-0 left-0 overflow-visible" width={1} height={1} style={{ pointerEvents: 'none' }} aria-hidden="true">
      {lines.map((line) => {
        const g = lineGeometry(line, byId)
        const color = paint(line.color)
        const size = 8 + line.width * 2.5
        return (
          <g key={line.id} data-line={line.id}>
            <path d={g.d} fill="none" stroke="transparent" strokeWidth={Math.max(14, line.width + 10)} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
            {selected.has(line.id) && <path data-export-skip d={g.d} fill="none" stroke="var(--color-accent-500)" strokeOpacity={0.35} strokeWidth={line.width + 8} strokeLinecap="round" />}
            <path d={g.d} fill="none" stroke={color} strokeWidth={line.width} strokeLinecap="round" strokeDasharray={line.dashed ? `${line.width * 4} ${line.width * 3}` : undefined} />
            {line.arrow !== 'none' && <path d={head(g.b, g.cb.x === g.b.x && g.cb.y === g.b.y ? g.a : g.cb, size)} fill={color} />}
            {line.arrow === 'both' && <path d={head(g.a, g.ca.x === g.a.x && g.ca.y === g.a.y ? g.b : g.ca, size)} fill={color} />}
          </g>
        )
      })}
    </svg>
  )
})

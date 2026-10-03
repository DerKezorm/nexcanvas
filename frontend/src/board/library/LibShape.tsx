import type { SVGProps } from 'react'

import { paint } from '../palette'
import type { Paint, ShapeDef, ShapeElement } from './types'

/** The colours an item hands to its shape: its fill and its line colour (`none` lines draw in the automatic ink). */
export interface ShapeColors {
  fill: string
  line: string
}

function colorOf(role: Paint | undefined, colors: ShapeColors): string {
  switch (role) {
    case 'fill':
      // An unfilled shape is paper where it would be filled: furniture hides the grid under it.
      return colors.fill === 'none' ? 'var(--color-board)' : paint(colors.fill)
    case 'line':
      return colors.line === 'none' ? 'var(--color-mist-100)' : paint(colors.line)
    case 'soft':
      return `color-mix(in srgb, ${colors.line === 'none' ? 'var(--color-mist-100)' : paint(colors.line)} 16%, transparent)`
    case 'paper':
      return 'var(--color-board)'
    default:
      return 'none'
  }
}

/**
 * One element as an SVG element: only the fields the format knows are read, so nothing a package holds besides
 * them reaches the page.
 */
function Element({ el, colors, thin }: { el: ShapeElement; colors: ShapeColors; thin?: boolean }) {
  const look: SVGProps<SVGElement> = {
    fill: el.t === 'line' ? 'none' : colorOf(el.f, colors),
    stroke: colorOf(el.s, colors),
    strokeWidth: (el.w ?? 2) * (thin ? 0.8 : 1),
    strokeDasharray: el.dash ? `${(el.w ?? 2) * 3} ${(el.w ?? 2) * 2.5}` : undefined,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
  }
  switch (el.t) {
    case 'path': {
      // Moved and stretched into place from numbers only (a drawing saved as a shape).
      const moved = el.tx !== undefined || el.ty !== undefined || el.sx !== undefined || el.sy !== undefined
      const transform = moved ? `translate(${Number(el.tx ?? 0)} ${Number(el.ty ?? 0)}) scale(${Number(el.sx ?? 1)} ${Number(el.sy ?? 1)})` : undefined
      return <path d={el.d} transform={transform} {...(look as SVGProps<SVGPathElement>)} />
    }
    case 'rect':
      return <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} {...(look as SVGProps<SVGRectElement>)} />
    case 'circle':
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...(look as SVGProps<SVGCircleElement>)} />
    case 'ellipse':
      return <ellipse cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...(look as SVGProps<SVGEllipseElement>)} />
    case 'line':
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...(look as SVGProps<SVGLineElement>)} />
    default:
      return null
  }
}

/** A shape of a package drawn into a box of w by h, stretched as the item is. */
export function LibShape({ def, w, h, colors, thin, className, interactive = true, x, y }: { def: ShapeDef; w: number; h: number; colors: ShapeColors; thin?: boolean; className?: string; interactive?: boolean; x?: number; y?: number }) {
  return (
    <svg
      x={x}
      y={y}
      className={className ?? 'absolute inset-0 overflow-visible'}
      width={w}
      height={h}
      viewBox={`0 0 ${def.vw} ${def.vh}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ pointerEvents: interactive ? undefined : 'none' }}
    >
      <g style={{ pointerEvents: interactive ? 'visiblePainted' : 'none' }}>
        {def.elements.map((el, index) => (
          <Element key={index} el={el} colors={colors} thin={thin} />
        ))}
      </g>
    </svg>
  )
}

/** A small picture of a shape for the library and menus, kept in proportion. */
export function ShapeTile({ def, size = 36 }: { def: ShapeDef; size?: number }) {
  const ratio = def.vw / def.vh
  const w = ratio >= 1 ? size : size * ratio
  const h = ratio >= 1 ? size / ratio : size
  return (
    <svg width={size} height={size} viewBox={`${(w - size) / 2} ${(h - size) / 2} ${size} ${size}`} aria-hidden="true" className="pointer-events-none">
      <svg width={w} height={h} viewBox={`0 0 ${def.vw} ${def.vh}`} preserveAspectRatio="none" overflow="visible">
        {def.elements.map((el, index) => (
          <Element key={index} el={el} colors={{ fill: def.fill && def.fill !== 'none' && def.fill !== 'paper' ? def.fill : 'none', line: 'none' }} thin />
        ))}
      </svg>
    </svg>
  )
}

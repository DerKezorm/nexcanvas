/** Short hands for drawing the shipped shapes: one call per element, the colour roles as in `types.ts`. */
import type { Paint, ShapeElement } from './types'

type Look = { f?: Paint; s?: Paint; w?: number; dash?: boolean }

export const path = (d: string, look: Look = {}): ShapeElement => ({ t: 'path', d, f: look.f ?? 'fill', s: look.s ?? 'line', ...(look.w ? { w: look.w } : {}), ...(look.dash ? { dash: true } : {}) })

/** A path only drawn as a line, never filled. */
export const stroke = (d: string, w?: number, dash?: boolean): ShapeElement => path(d, { f: 'none', w, dash })

export const rect = (x: number, y: number, width: number, height: number, look: Look & { rx?: number } = {}): ShapeElement => ({
  t: 'rect',
  x,
  y,
  width,
  height,
  ...(look.rx ? { rx: look.rx } : {}),
  f: look.f ?? 'fill',
  s: look.s ?? 'line',
  ...(look.w ? { w: look.w } : {}),
  ...(look.dash ? { dash: true } : {}),
})

export const circle = (cx: number, cy: number, r: number, look: Look = {}): ShapeElement => ({ t: 'circle', cx, cy, r, f: look.f ?? 'fill', s: look.s ?? 'line', ...(look.w ? { w: look.w } : {}) })

export const ellipse = (cx: number, cy: number, rx: number, ry: number, look: Look = {}): ShapeElement => ({ t: 'ellipse', cx, cy, rx, ry, f: look.f ?? 'fill', s: look.s ?? 'line', ...(look.w ? { w: look.w } : {}) })

export const line = (x1: number, y1: number, x2: number, y2: number, w?: number, dash?: boolean): ShapeElement => ({ t: 'line', x1, y1, x2, y2, s: 'line', ...(w ? { w } : {}), ...(dash ? { dash: true } : {}) })

/** Corners as parts of the box, from points in the drawing's own units. */
export const outline = (vw: number, vh: number, points: [number, number][]) => points.map(([x, y]) => ({ x: x / vw, y: y / vh }))

/** Several lines at once, e.g. the steps of a stair. */
export const lines = (count: number, each: (i: number) => [number, number, number, number], w?: number): ShapeElement[] =>
  Array.from({ length: count }, (_, i) => {
    const [x1, y1, x2, y2] = each(i)
    return line(x1, y1, x2, y2, w)
  })

export const BLUE = '#60a5fa'
export const LIGHT = '#bfdbfe'
/** Words under a symbol. */
export const BELOW = { x: -0.8, y: 1.04, w: 2.6, h: 0.45 }

const round1 = (n: number) => Math.round(n * 10) / 10

/** A closed path through points. */
export const through = (points: [number, number][]) => 'M' + points.map(([x, y]) => `${round1(x)} ${round1(y)}`).join('L') + 'Z'

/** A star of `count` points around cx, cy, its tips at `outer` and its dents at `inner`; the first tip at the top. */
export function starPoints(count: number, cx: number, cy: number, outer: number, inner: number): [number, number][] {
  return Array.from({ length: count * 2 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / count
    const r = i % 2 === 0 ? outer : inner
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number]
  })
}

/** A regular polygon of `count` corners around cx, cy, the first corner at the top. */
export const polygonPoints = (count: number, cx: number, cy: number, r: number): [number, number][] =>
  Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number]
  })

/** A gear wheel of `teeth` teeth around cx, cy: tips at `outer`, the wheel at `inner`. */
export function gearPath(teeth: number, cx: number, cy: number, outer: number, inner: number): string {
  const step = (2 * Math.PI) / teeth
  const at = (angle: number, r: number): [number, number] => [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  const points: [number, number][] = []
  for (let i = 0; i < teeth; i++) {
    const base = -Math.PI / 2 + i * step
    points.push(at(base - 0.3 * step, inner), at(base - 0.18 * step, outer), at(base + 0.18 * step, outer), at(base + 0.3 * step, inner))
  }
  return through(points)
}

/** A detail drawn on the fill (a divider, a symbol on a box): in the ink that reads on it, as the words do. */
export const mark = (d: string, w?: number, dash?: boolean): ShapeElement => path(d, { f: 'none', s: 'ink', w, dash })

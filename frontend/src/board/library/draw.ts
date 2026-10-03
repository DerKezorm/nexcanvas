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

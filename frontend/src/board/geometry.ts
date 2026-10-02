import type { End, Item, LineItem, ShapeKind, View } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export function bounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w)
    y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function normalize(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function toScreen(p: Point, v: View): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y }
}

export function toBoard(p: Point, v: View): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
}

/** Where the line from the middle of `r` towards `toward` leaves the box, and which way the edge faces there. */
export function edgePoint(r: Rect, toward: Point, gap = 6): { p: Point; n: Point } {
  const c = center(r)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return { p: c, n: { x: 0, y: -1 } }
  const hw = r.w / 2 + gap
  const hh = r.h / 2 + gap
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx)
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy)
  if (sx < sy) {
    return { p: { x: c.x + dx * sx, y: c.y + dy * sx }, n: { x: Math.sign(dx), y: 0 } }
  }
  return { p: { x: c.x + dx * sy, y: c.y + dy * sy }, n: { x: 0, y: Math.sign(dy) } }
}

export interface LineGeometry {
  a: Point
  b: Point
  /** Control points, the same as the ends for a straight line. */
  ca: Point
  cb: Point
  d: string
}

/** Like edgePoint, but on the curve of a round item, so lines touch circles instead of their corners. */
function attach(item: Item, toward: Point, gap = 6): { p: Point; n: Point } {
  if (item.kind !== 'shape' || item.shape !== 'ellipse') return edgePoint(item, toward, gap)
  const c = center(item)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const len = Math.hypot(dx, dy) || 1
  const k = 1 / Math.sqrt((dx / (item.w / 2)) ** 2 + (dy / (item.h / 2)) ** 2 || 1)
  const u = { x: dx / len, y: dy / len }
  return { p: { x: c.x + dx * k + u.x * gap, y: c.y + dy * k + u.y * gap }, n: u }
}

function endTarget(end: End, items: Map<string, Item>): Point {
  const item = end.item ? items.get(end.item) : undefined
  return item ? center(item) : { x: end.x, y: end.y }
}

/** The path of a line, with its ends placed on the edges of the items it connects. */
export function lineGeometry(line: LineItem, items: Map<string, Item>): LineGeometry {
  const ta = endTarget(line.a, items)
  const tb = endTarget(line.b, items)
  const ia = line.a.item ? items.get(line.a.item) : undefined
  const ib = line.b.item ? items.get(line.b.item) : undefined
  const ea = ia ? attach(ia, tb) : { p: ta, n: null }
  const eb = ib ? attach(ib, ta) : { p: tb, n: null }
  const a = ea.p
  const b = eb.p
  if (!line.curve) {
    return { a, b, ca: a, cb: b, d: `M${a.x} ${a.y}L${b.x} ${b.y}` }
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const pull = Math.min(160, dist * 0.45)
  const dir = (from: Point, to: Point) => {
    const l = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return { x: (to.x - from.x) / l, y: (to.y - from.y) / l }
  }
  const na = ea.n ?? dir(a, b)
  const nb = eb.n ?? dir(b, a)
  const ca = { x: a.x + na.x * pull, y: a.y + na.y * pull }
  const cb = { x: b.x + nb.x * pull, y: b.y + nb.y * pull }
  return { a, b, ca, cb, d: `M${a.x} ${a.y}C${ca.x} ${ca.y} ${cb.x} ${cb.y} ${b.x} ${b.y}` }
}

/** The angle at which an arrowhead points, taken from the last control point. */
export function arrowAngle(tip: Point, from: Point): number {
  return Math.atan2(tip.y - from.y, tip.x - from.x)
}

/** Shapes as SVG paths in a box of w by h, starting at 0,0. */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  switch (kind) {
    case 'rect':
      return `M0 0H${w}V${h}H0Z`
    case 'round': {
      const r = Math.min(24, w / 4, h / 4)
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`
    }
    case 'ellipse':
      return `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h}A${w / 2} ${h / 2} 0 1 1 ${w / 2} 0Z`
    case 'triangle':
      return `M${w / 2} 0L${w} ${h}H0Z`
    case 'diamond':
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`
    case 'hexagon':
      return `M${w * 0.25} 0H${w * 0.75}L${w} ${h / 2}L${w * 0.75} ${h}H${w * 0.25}L0 ${h / 2}Z`
    case 'star': {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 0.5 : 0.21
        pts.push(`${w / 2 + Math.cos(angle) * w * r} ${h / 2 + Math.sin(angle) * h * r * 1.05 + h * 0.04}`)
      }
      return `M${pts.join('L')}Z`
    }
    case 'arrow':
      return `M0 ${h * 0.3}H${w * 0.62}V0L${w} ${h / 2}L${w * 0.62} ${h}V${h * 0.7}H0Z`
    case 'speech': {
      const r = Math.min(20, w / 5, h / 5)
      const bh = h * 0.78
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${bh - r}Q${w} ${bh} ${w - r} ${bh}H${w * 0.38}L${w * 0.18} ${h}L${w * 0.22} ${bh}H${r}Q0 ${bh} 0 ${bh - r}V${r}Q0 0 ${r} 0Z`
    }
  }
}

/** Where text sits inside a shape, so it does not run over the pointed parts. */
export function shapeTextBox(kind: ShapeKind, w: number, h: number): Rect {
  switch (kind) {
    case 'triangle':
      return { x: w * 0.22, y: h * 0.45, w: w * 0.56, h: h * 0.5 }
    case 'diamond':
      return { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }
    case 'star':
      return { x: w * 0.3, y: h * 0.35, w: w * 0.4, h: h * 0.35 }
    case 'arrow':
      return { x: 0, y: h * 0.3, w: w * 0.8, h: h * 0.4 }
    case 'speech':
      return { x: 0, y: 0, w, h: h * 0.78 }
    case 'ellipse':
      return { x: w * 0.12, y: h * 0.12, w: w * 0.76, h: h * 0.76 }
    default:
      return { x: 0, y: 0, w, h }
  }
}

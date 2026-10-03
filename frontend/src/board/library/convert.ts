/**
 * Making shapes for a package: from an SVG file, or from what is selected on the board ("save as shape"). Both end in
 * the same short list of elements the format allows; colours become roles (filled parts take the item's fill, lines
 * its line colour), so the new shape can be coloured like any other.
 */
import { bounds, shapePath } from '../geometry'
import { inkPath } from '../ink'
import type { Item } from '../types'
import type { Paint, ShapeDef, ShapeElement } from './types'

const MAX_ELEMENTS = 300

/** A shape id from a name: lower case letters, digits and dashes, and a short random end so two never meet. */
export function shapeId(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return `${base || 'shape'}-${Math.random().toString(36).slice(2, 6)}`
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** Any element as path data in its own units, so it can be moved and stretched as a path. */
export function asPath(el: ShapeElement): string {
  switch (el.t) {
    case 'path':
      return el.d
    case 'rect': {
      const r = Math.min(el.rx ?? 0, el.width / 2, el.height / 2)
      if (!r) return `M${el.x} ${el.y}H${el.x + el.width}V${el.y + el.height}H${el.x}Z`
      const { x, y, width: w, height: h } = el
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
    }
    case 'circle':
      return `M${el.cx - el.r} ${el.cy}A${el.r} ${el.r} 0 1 0 ${el.cx + el.r} ${el.cy}A${el.r} ${el.r} 0 1 0 ${el.cx - el.r} ${el.cy}Z`
    case 'ellipse':
      return `M${el.cx - el.rx} ${el.cy}A${el.rx} ${el.ry} 0 1 0 ${el.cx + el.rx} ${el.cy}A${el.rx} ${el.ry} 0 1 0 ${el.cx - el.rx} ${el.cy}Z`
    case 'line':
      return `M${el.x1} ${el.y1}L${el.x2} ${el.y2}`
  }
}

/** An element moved by tx, ty and stretched by sx, sy on top of whatever it already had. */
function placed(el: ShapeElement, tx: number, ty: number, sx: number, sy: number): ShapeElement {
  const inner = el.t === 'path' ? el : null
  const look = { f: el.t === 'line' ? ('none' as Paint) : el.f, s: el.s, w: el.w, dash: el.dash }
  return {
    t: 'path',
    d: asPath(el),
    ...(look.f ? { f: look.f } : {}),
    ...(look.s ? { s: look.s } : {}),
    ...(look.w !== undefined ? { w: look.w } : {}),
    ...(look.dash ? { dash: true } : {}),
    tx: round(tx + sx * (inner?.tx ?? 0)),
    ty: round(ty + sy * (inner?.ty ?? 0)),
    sx: round(sx * (inner?.sx ?? 1)),
    sy: round(sy * (inner?.sy ?? 1)),
  }
}

/**
 * What is selected, as one shape: basic shapes, shapes of packages, notes and drawings come along; texts, photos,
 * files, links and frames have no lines to keep and stay out (`left` counts them).
 */
export function selectionToShape(items: Item[], name: string, lookup: (key: string) => ShapeDef | undefined): { shape: ShapeDef | null; left: number } {
  // The box of what comes along only: a text left out does not leave a hole beside the shape.
  const kept = items.filter((i) => i.kind === 'shape' || i.kind === 'note' || i.kind === 'ink')
  const box = bounds(kept.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })))
  if (!box || box.w < 1 || box.h < 1) return { shape: null, left: items.length }
  const elements: ShapeElement[] = []
  let left = 0
  let fill: string | undefined
  for (const item of items) {
    const tx = item.x - box.x
    const ty = item.y - box.y
    if (item.kind === 'shape') {
      const def = item.lib ? lookup(item.lib) : undefined
      if (def) {
        for (const el of def.elements) elements.push(placed(el, tx, ty, item.w / def.vw, item.h / def.vh))
      } else {
        elements.push({ t: 'path', d: shapePath(item.shape, item.w, item.h), f: item.fill === 'none' ? 'none' : 'fill', s: item.stroke !== 'none' || item.fill === 'none' ? 'line' : 'none', tx: round(tx), ty: round(ty) })
      }
      if (!fill && item.fill !== 'none') fill = item.fill
    } else if (item.kind === 'note') {
      elements.push({ t: 'path', d: `M0 0H${item.w}V${item.h}H0Z`, f: 'fill', s: 'none', tx: round(tx), ty: round(ty) })
    } else if (item.kind === 'ink') {
      elements.push({ t: 'path', d: inkPath(item), f: 'line', s: 'none', tx: round(tx), ty: round(ty), sx: round(item.w / item.ow), sy: round(item.h / item.oh) })
    } else {
      left++
    }
  }
  if (!elements.length) return { shape: null, left }
  return {
    shape: {
      id: shapeId(name),
      name: { de: name, en: name },
      vw: round(box.w),
      vh: round(box.h),
      elements: elements.slice(0, MAX_ELEMENTS),
      fill: fill ?? '#60a5fa',
    },
    left,
  }
}

// ---------- SVG ----------

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/

function style(el: Element, key: string): string | null {
  const own = el.getAttribute(key)
  if (own !== null) return own.trim()
  const inline = el.getAttribute('style') ?? ''
  const match = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`).exec(inline)
  if (match) return match[1].trim()
  return el.parentElement && el.parentElement.tagName.toLowerCase() !== 'svg' ? style(el.parentElement, key) : null
}

function num(el: Element, key: string): number {
  const value = (el.getAttribute(key) ?? '0').replace(/px$/, '')
  return NUMBER.test(value) ? Number(value) : NaN
}

/** A plain move of an element or its groups (`translate(x y)`); anything else is left as it is. */
function moved(el: Element): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let node: Element | null = el; node && node.tagName.toLowerCase() !== 'svg'; node = node.parentElement) {
    const t = /translate\(\s*(-?[\d.e]+)[\s,]*(-?[\d.e]+)?\s*\)/i.exec(node.getAttribute('transform') ?? '')
    if (t) {
      x += Number(t[1])
      y += Number(t[2] ?? 0)
    }
  }
  return { x, y }
}

/** Filled parts in black, `currentColor` or without a fill read as lines (as icons draw them), others as the fill. */
function fillRole(value: string | null): Paint {
  if (value === null) return 'line'
  const v = value.toLowerCase()
  if (v === 'none' || v === 'transparent') return 'none'
  if (v === 'currentcolor' || v === 'black' || v === '#000' || v === '#000000') return 'line'
  return 'fill'
}

/**
 * An SVG file as a shape. Read by the browser's own parser, which never runs what it reads; only the drawing elements
 * (paths, rectangles, circles, ellipses, lines, polygons) come along, with their place and whether they are filled or
 * drawn. Throws when nothing drawable is in it.
 */
export function svgToShape(text: string, fileName: string): ShapeDef {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg' || parsed.getElementsByTagName('parsererror').length) throw new Error('not_svg')
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const [ox, oy, vw, vh] = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box : [0, 0, num(root, 'width') || 100, num(root, 'height') || 100]
  const elements: ShapeElement[] = []
  // The file's own first colour becomes the shape's fill, so a green tree stays green when placed.
  let firstFill: string | undefined
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase().replace(/^svg:/, '')
      // Only groups are entered: what sits in defs, masks, symbols or scripts is never drawn from here.
      if (style(child, 'display') === 'none') continue
      if (tag === 'g' || tag === 'a' || tag === 'switch') {
        walk(child)
        continue
      }
      const at = moved(child)
      const fillValue = style(child, 'fill')
      const f = fillRole(fillValue)
      if (f === 'fill' && !firstFill && fillValue && /^#[0-9a-f]{6}$/i.test(fillValue)) firstFill = fillValue.toLowerCase()
      if (f === 'fill' && !firstFill && fillValue && /^#[0-9a-f]{3}$/i.test(fillValue)) firstFill = ('#' + [...fillValue.slice(1)].map((c) => c + c).join('')).toLowerCase()
      const strokeValue = style(child, 'stroke')
      const s: Paint = strokeValue && strokeValue !== 'none' ? 'line' : 'none'
      const widthValue = Number((style(child, 'stroke-width') ?? '').replace(/px$/, ''))
      const w = s !== 'none' && Number.isFinite(widthValue) && widthValue > 0 ? Math.min(50, widthValue) : undefined
      let d: string | null = null
      if (tag === 'path') d = child.getAttribute('d')
      else if (tag === 'polygon' || tag === 'polyline') {
        const pts = (child.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
        if (pts.length >= 4 && pts.every(Number.isFinite)) {
          d = 'M' + pts.reduce<string[]>((out, value, i) => (i % 2 ? out : [...out, `${value} ${pts[i + 1]}`]), []).join('L') + (tag === 'polygon' ? 'Z' : '')
        }
      } else if (tag === 'rect') d = asPath({ t: 'rect', x: num(child, 'x'), y: num(child, 'y'), width: num(child, 'width'), height: num(child, 'height'), rx: num(child, 'rx') || undefined })
      else if (tag === 'circle') d = asPath({ t: 'circle', cx: num(child, 'cx'), cy: num(child, 'cy'), r: num(child, 'r') })
      else if (tag === 'ellipse') d = asPath({ t: 'ellipse', cx: num(child, 'cx'), cy: num(child, 'cy'), rx: num(child, 'rx'), ry: num(child, 'ry') })
      else if (tag === 'line') d = asPath({ t: 'line', x1: num(child, 'x1'), y1: num(child, 'y1'), x2: num(child, 'x2'), y2: num(child, 'y2') })
      if (!d || d.includes('NaN') || !PATH.test(d) || d.length > 20000) continue
      const lineOnly = tag === 'line' || tag === 'polyline'
      const element: ShapeElement = { t: 'path', d: d.replace(/\s+/g, ' ').trim(), f: lineOnly ? 'none' : f, s: lineOnly && s === 'none' ? 'line' : s }
      if (w) element.w = w
      if (at.x - ox || at.y - oy) {
        element.tx = round(at.x - ox)
        element.ty = round(at.y - oy)
      }
      elements.push(element)
      if (elements.length >= MAX_ELEMENTS) return
    }
  }
  walk(root)
  if (!elements.length) throw new Error('empty_svg')
  const name = fileName.replace(/\.svg$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Shape'
  return { id: shapeId(name), name: { de: name, en: name }, vw: round(vw), vh: round(vh), elements, fill: firstFill ?? '#60a5fa' }
}

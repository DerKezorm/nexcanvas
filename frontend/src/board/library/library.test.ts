/** Shape packages: the shipped shapes keep to the format the server checks, SVG and selections become shapes. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { attach } from '../geometry'
import type { Item } from '../types'
import { BUILTIN } from './builtin'
import { selectionToShape, svgToShape } from './convert'
import { ICON_PACKAGES, loadIconPackages } from './icons'
import { LibShape } from './LibShape'
import type { ShapeDef } from './types'
import { makeLookup, outlineFor, shipped } from './registry'

// The server's rules (backend/app/services/shapepacks.py), here for the shapes that never pass through it.
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/
const PAINTS = new Set(['fill', 'line', 'ink', 'soft', 'paper', 'none', undefined])

describe('the shipped packages', () => {
  it('keep to the format: ids, names in both languages, paths, colours, places', () => {
    const packages = new Set<string>()
    for (const pkg of BUILTIN) {
      expect(pkg.id).toMatch(ID)
      expect(packages.has(pkg.id)).toBe(false)
      packages.add(pkg.id)
      expect(pkg.name.de && pkg.name.en).toBeTruthy()
      const ids = new Set<string>()
      for (const shape of pkg.shapes) {
        expect(shape.id, `${pkg.id}/${shape.id}`).toMatch(ID)
        expect(ids.has(shape.id), `${pkg.id}/${shape.id} twice`).toBe(false)
        ids.add(shape.id)
        expect(shape.name.de && shape.name.en, shape.id).toBeTruthy()
        expect(shape.vw).toBeGreaterThan(0)
        expect(shape.vh).toBeGreaterThan(0)
        expect(shape.elements.length).toBeGreaterThan(0)
        for (const el of shape.elements) {
          if (el.t === 'path') expect(el.d, `${pkg.id}/${shape.id}`).toMatch(PATH)
          if (el.t !== 'line') expect(PAINTS.has(el.f), `${pkg.id}/${shape.id} fill ${el.f}`).toBe(true)
          expect(PAINTS.has(el.s), `${pkg.id}/${shape.id} line ${el.s}`).toBe(true)
          for (const value of Object.values(el)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
        }
        if (shape.outline) {
          expect(shape.outline.length).toBeGreaterThanOrEqual(3)
          for (const p of shape.outline) expect(p.x >= -1 && p.x <= 2 && p.y >= -1 && p.y <= 2).toBe(true)
        }
        if (shape.fill) expect(shape.fill === 'none' || /^#[0-9a-f]{6}$/i.test(shape.fill), `${shape.id} fill`).toBe(true)
        expect((shape.words ?? []).length, shape.id).toBeLessThanOrEqual(20)
        for (const word of shape.words ?? []) expect(word.length, shape.id).toBeLessThanOrEqual(40)
        if (shape.word !== undefined) expect(shape.word.length).toBeLessThanOrEqual(40)
      }
    }
    expect([...packages]).toEqual(['basic', 'flow', 'room', 'project', 'network', 'uml', 'bpmn', 'house', 'signs'])
    // More is better than less: every package holds a good handful, together several hundred.
    for (const pkg of BUILTIN) expect(pkg.shapes.length, pkg.id).toBeGreaterThanOrEqual(25)
    expect(BUILTIN.reduce((n, pkg) => n + pkg.shapes.length, 0)).toBeGreaterThanOrEqual(300)
  })

  it('begin with the shapes of the toolbar, placed as those', () => {
    const basic = BUILTIN.find((p) => p.id === 'basic')!
    const first = basic.shapes.slice(0, 9)
    expect(first.map((s) => s.native)).toEqual(['rect', 'round', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'arrow', 'speech'])
    expect(first.every((s) => s.id === s.native)).toBe(true)
    // Nothing else claims to be one of them.
    expect(BUILTIN.flatMap((p) => p.shapes).filter((s) => s.native)).toHaveLength(9)
  })

  it('start a number marker with a number', () => {
    expect(makeLookup()('signs/marker')?.word).toBe('1')
  })

  it('draw the floor plan in centimetres', () => {
    const room = BUILTIN.find((p) => p.id === 'room')!
    const bed = room.shapes.find((s) => s.id === 'double-bed')!
    expect([bed.w, bed.h]).toEqual([180, 200])
    expect(room.shapes.find((s) => s.id === 'dimension')?.measure).toBe(true)
  })

  it('are found by the board, and their own shapes come before any package', () => {
    const own = { ...BUILTIN[0].shapes[0], name: { en: 'Mine' } }
    const lookup = makeLookup([{ id: 'p3', name: { en: 'X' }, version: '1', author: '', license: '', shapes: [{ ...own, id: 'thing', name: { en: 'Package' } }] }], { 'p3/thing': { ...own, id: 'thing' } })
    expect(lookup('network/router')?.id).toBe('router')
    expect(lookup('p3/thing')?.name.en).toBe('Mine')
    expect(lookup('p3/none')).toBeUndefined()
    expect(shipped('room/bed')).toBe(true)
    expect(shipped('p3/thing')).toBe(false)
  })
})

describe('the colours of a shape', () => {
  const def: ShapeDef = {
    id: 'box', name: { en: 'Box' }, vw: 10, vh: 10,
    elements: [{ t: 'rect', x: 0, y: 0, width: 10, height: 10, f: 'fill', s: 'line' }, { t: 'path', d: 'M0 5H10', f: 'none', s: 'ink' }],
  }
  const strokes = (fill: string, line: string) => [...renderToStaticMarkup(createElement(LibShape, { def, w: 10, h: 10, colors: { fill, line } })).matchAll(/stroke="([^"]+)"/g)].map((m) => m[1])

  it('draw details on the fill in the ink that reads on it, and the outline in the line colour', () => {
    expect(strokes('#fde68a', 'none')).toEqual(['var(--color-mist-100)', '#1c1917'])
    expect(strokes('#3f3f46', 'none')).toEqual(['var(--color-mist-100)', '#fafafa'])
    expect(strokes('none', 'none')).toEqual(['var(--color-mist-100)', 'var(--color-mist-100)'])
    // A line colour someone picked wins everywhere.
    expect(strokes('#fde68a', '#f87171')).toEqual(['#f87171', '#f87171'])
  })
})

describe('the icon packages', () => {
  it('hold every Lucide symbol as lines, and themed ones in two colours, in the format the server checks', async () => {
    const packages = await loadIconPackages()
    expect(packages.map((p) => p.id)).toEqual(ICON_PACKAGES.map((p) => p.id))
    const all = packages.find((p) => p.id === 'icons')!
    expect(all.shapes.length).toBeGreaterThan(1500)
    expect(all.shapes.every((s) => s.elements.every((el) => el.t === 'line' || el.f === 'none'))).toBe(true)
    for (const pkg of packages) {
      expect(pkg.id).toMatch(ID)
      expect(pkg.shapes.length, pkg.id).toBeGreaterThanOrEqual(25)
      const ids = new Set<string>()
      for (const shape of pkg.shapes) {
        expect(shape.id).toMatch(ID)
        expect(ids.has(shape.id)).toBe(false)
        ids.add(shape.id)
        expect(shape.elements.length).toBeGreaterThan(0)
        expect(shape.elements.length).toBeLessThanOrEqual(300)
        expect((shape.words ?? []).length).toBeLessThanOrEqual(20)
        for (const el of shape.elements) {
          if (el.t === 'path') expect(el.d, `${pkg.id}/${shape.id}`).toMatch(PATH)
          for (const value of Object.values(el)) if (typeof value === 'number') expect(Number.isFinite(value), `${pkg.id}/${shape.id}`).toBe(true)
        }
      }
    }
    const devices = packages.find((p) => p.id === 'icons-devices')!
    const router = devices.shapes.find((s) => s.id === 'router')!
    expect(router.elements.some((el) => el.t !== 'line' && el.f === 'fill')).toBe(true)
  })

  it('are found in German by whole parts of their names', async () => {
    const all = (await loadIconPackages()).find((p) => p.id === 'icons')!
    expect(all.shapes.find((s) => s.id === 'printer')?.words).toContain('drucker')
    expect(all.shapes.find((s) => s.id === 'map-pin')?.words).toContain('adresse')
    // "Adresse" means the map pin, not every map.
    expect(all.shapes.find((s) => s.id === 'map')?.words ?? []).not.toContain('adresse')
  })

  it('keep the polylines and polygons Lucide draws some symbols with', async () => {
    const all = (await loadIconPackages()).find((p) => p.id === 'icons')!
    const navigation = all.shapes.find((s) => s.id === 'navigation')!
    expect(navigation.elements).toHaveLength(1)
    expect(navigation.elements[0]).toMatchObject({ t: 'path' })
    expect((navigation.elements[0] as { d: string }).d).toMatch(/^M[\d. ]+(L[\d. ]+)+Z$/)
    const inbox = all.shapes.find((s) => s.id === 'inbox')!
    expect(inbox.elements.some((el) => el.t === 'path' && /^M[\d. ]+(L[\d. ]+)+$/.test(el.d))).toBe(true)
  })
})

describe('lines meet shapes of packages', () => {
  it('on their outline, else on their box', () => {
    const lookup = makeLookup()
    const decision = { id: 'd', kind: 'shape', x: 0, y: 0, w: 140, h: 90, shape: 'rect', lib: 'flow/decision', fill: '#fff', stroke: 'none', text: '' } as Item
    const hit = attach(decision, { x: 400, y: 300 }, 0, outlineFor(lookup))
    // The lower right side of the diamond: from (140, 45) to (70, 90).
    expect(hit.p.x / 140 + hit.p.y / 90).toBeCloseTo(1.5)
    const box = attach(decision, { x: 400, y: 300 })
    expect(box.p.x === 140 || box.p.y === 90).toBe(true)
  })
})

describe('an SVG file becomes a shape', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
    <script>alert(1)</script>
    <defs><path id="hidden" d="M0 0L1 1"/></defs>
    <foreignObject><div>x</div></foreignObject>
    <path d="M10 20H60V40H10Z" fill="#ff0000"/>
    <rect x="20" y="30" width="10" height="10" fill="none" stroke="#000" stroke-width="3"/>
    <g transform="translate(5, 6)"><circle cx="70" cy="40" r="5"/></g>
    <polygon points="10,20 30,20 20,35" fill="currentColor"/>
    <image href="https://example.com/x.png"/>
  </svg>`

  it('keeps only drawing elements, with their place and roles', () => {
    const shape = svgToShape(svg, 'My_router.svg')
    expect(shape.name).toEqual({ de: 'My router', en: 'My router' })
    expect(shape.vw).toBe(100)
    expect(shape.vh).toBe(50)
    expect(shape.elements).toHaveLength(4)
    const [path, rect, circle, polygon] = shape.elements
    expect(path).toMatchObject({ t: 'path', f: 'fill', s: 'none', tx: -10, ty: -20 })
    expect(rect).toMatchObject({ f: 'none', s: 'line', w: 3 })
    expect(circle).toMatchObject({ f: 'line', tx: -5, ty: -14 })
    expect(polygon).toMatchObject({ d: 'M10 20L30 20L20 35Z', f: 'line' })
    expect(shape.fill).toBe('#ff0000')
    expect(JSON.stringify(shape)).not.toMatch(/script|alert|example\.com|div/)
  })

  it('refuses what is no SVG, and an SVG without anything to draw', () => {
    expect(() => svgToShape('<html><body>hi</body></html>', 'x.svg')).toThrow('not_svg')
    expect(() => svgToShape('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>', 'x.svg')).toThrow('empty_svg')
  })
})

describe('a selection becomes a shape', () => {
  it('takes shapes, notes and drawings in their places, and leaves texts out', () => {
    const items: Item[] = [
      { id: 'a', kind: 'shape', x: 100, y: 100, w: 50, h: 50, shape: 'ellipse', fill: '#4ade80', stroke: 'none', text: 'x' },
      { id: 'b', kind: 'note', x: 200, y: 120, w: 40, h: 40, color: 'yellow', text: '' },
      { id: 'c', kind: 'ink', x: 150, y: 200, w: 20, h: 10, ow: 10, oh: 5, points: [[0, 0, 0.5], [10, 5, 0.5]], color: 'auto', size: 3 },
      { id: 'd', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'hi', size: 'm', color: 'auto' },
    ]
    const { shape, left } = selectionToShape(items, 'Gärtchen', makeLookup())
    expect(left).toBe(1)
    expect(shape?.id).toMatch(/^gartchen-[a-z0-9]{1,4}$/)
    expect([shape?.vw, shape?.vh]).toEqual([140, 110])
    expect(shape?.elements).toHaveLength(3)
    expect(shape?.elements[0]).toMatchObject({ tx: 0, ty: 0, f: 'fill' })
    expect(shape?.elements[1]).toMatchObject({ tx: 100, ty: 20, f: 'fill' })
    expect(shape?.elements[2]).toMatchObject({ tx: 50, ty: 100, sx: 2, sy: 2, f: 'line' })
    expect(shape?.fill).toBe('#4ade80')
  })

  it('takes a shape of a package along, moved and stretched into place', () => {
    const bed = { id: 'b', kind: 'shape', x: 10, y: 20, w: 90, h: 100, shape: 'rect', lib: 'room/bed', fill: 'none', stroke: 'none', text: '' } as Item
    const { shape } = selectionToShape([bed], 'Bed', makeLookup())
    expect(shape?.elements.every((el) => el.t === 'path')).toBe(true)
    expect(shape?.elements[0]).toMatchObject({ tx: 0, ty: 0, sx: 1, sy: 0.5 })
  })
})

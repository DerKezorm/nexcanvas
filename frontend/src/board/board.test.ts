/** The arithmetic behind turning, the order things are drawn in, and the PDF writer. */

import { attach, bounds, lineGeometry, outer, turn } from './geometry'
import { branchItem, placeBeside, sideToward } from './branch'
import { backgroundStyle, effectiveBackground, gridStep, inkVariables } from './background'
import { arrange } from './arrange'
import { drawOrder, waitingInk } from './order'
import { pdfOfPictures } from './pdf'
import type { Item } from './types'

const note = (id: string, extra: Partial<Item> = {}): Item => ({ id, kind: 'note', x: 0, y: 0, w: 100, h: 50, color: 'yellow', text: '', ...extra }) as Item

describe('turning', () => {
  it('turns a point around another', () => {
    const p = turn({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })

  it('gives a turned item the upright box it covers', () => {
    expect(outer(note('a'))).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    const quarter = outer(note('a', { rot: 90 }))
    expect(quarter.w).toBeCloseTo(50)
    expect(quarter.h).toBeCloseTo(100)
    expect(quarter.x).toBeCloseTo(25)
    expect(quarter.y).toBeCloseTo(-25)
  })

  it('counts turned items with their covered box in the bounds', () => {
    const box = bounds([note('a', { rot: 90 })])!
    expect(box.y).toBeCloseTo(-25)
    expect(box.h).toBeCloseTo(100)
  })
})

describe('draw order', () => {
  const pdf: Item = { id: 'pdf', kind: 'file', x: 0, y: 0, w: 300, h: 400, media: 'm', name: 'a.pdf', ext: 'pdf', sizeLabel: '1 KB', pages: 3, page: 2 }
  const ink = (id: string, page: number): Item => ({ id, kind: 'ink', x: 0, y: 0, w: 10, h: 10, ow: 10, oh: 10, points: [], color: 'auto', size: 3, on: { item: 'pdf', page } })

  it('puts frames under everything, whenever they were made', () => {
    const frame: Item = { id: 'f', kind: 'frame', x: 0, y: 0, w: 10, h: 10, title: '', color: 'auto' }
    expect(drawOrder([note('a'), frame, note('b')]).map((i) => i.id)).toEqual(['f', 'a', 'b'])
  })

  it('leaves out the drawings of the PDF pages not showing', () => {
    const items = [pdf, ink('on1', 1), ink('on2', 2), { ...ink('loose', 1), on: undefined } as Item]
    expect([...waitingInk(items)]).toEqual(['on1'])
    expect(drawOrder(items).map((i) => i.id)).toEqual(['pdf', 'on2', 'loose'])
  })

  it('shows a drawing whose PDF is gone', () => {
    expect(waitingInk([ink('orphan', 5)]).size).toBe(0)
  })
})

describe('PDF of pictures', () => {
  it('writes one page per picture with a cross-reference that points at each object', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
    const blob = pdfOfPictures([
      { jpeg, width: 20, height: 10, w: 150, h: 75 },
      { jpeg, width: 20, height: 10, w: 150, h: 75 },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2)
    const start = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(start, start + 4)).toBe('xref')
    // Every offset in the table lands on "<n> 0 obj".
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(8)
    offsets.forEach((offset, n) => expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${n + 1} 0 obj`)))
  })

  it('keeps a page within what PDF readers accept', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const text = await pdfOfPictures([{ jpeg, width: 1, height: 1, w: 30000, h: 15000 }]).text()
    expect(text).toContain('/MediaBox [0 0 14400 7200]')
  })
})

describe('lining up and spreading', () => {
  const box = (id: string, x: number, y: number, w = 100, h = 50, extra: Partial<Item> = {}): Item => note(id, { x, y, w, h, ...extra })

  it('lines up on the left edge of all', () => {
    const moves = arrange([box('a', 10, 0), box('b', 50, 100), box('c', 30, 200)], new Set(['a', 'b', 'c']), 'left')
    expect(moves.get('a')).toBeUndefined()
    expect(moves.get('b')).toEqual({ dx: -40, dy: 0 })
    expect(moves.get('c')).toEqual({ dx: -20, dy: 0 })
  })

  it('moves a group as one block', () => {
    const items = [box('a', 0, 0), box('b', 200, 0, 100, 50, { group: 'g' }), box('c', 400, 100, 100, 50, { group: 'g' })]
    const moves = arrange(items, new Set(['a', 'b', 'c']), 'top')
    // The group's top is at 0 already; its members keep their places to each other.
    expect(moves.size).toBe(0)
    const bottom = arrange(items, new Set(['a', 'b', 'c']), 'bottom')
    expect(bottom.get('a')).toEqual({ dx: 0, dy: 100 })
    expect(bottom.get('b')).toBeUndefined()
  })

  it('spreads with equal gaps, the outer ones staying', () => {
    const moves = arrange([box('a', 0, 0), box('b', 120, 0), box('c', 400, 0)], new Set(['a', 'b', 'c']), 'spreadX')
    expect(moves.get('a')).toBeUndefined()
    expect(moves.get('c')).toBeUndefined()
    // Room 500 - 300 = 200, two gaps of 100: b goes to 200.
    expect(moves.get('b')).toEqual({ dx: 80, dy: 0 })
  })

  it('leaves frames and locked items where they are', () => {
    const frame: Item = { id: 'f', kind: 'frame', x: -500, y: 0, w: 10, h: 10, title: '', color: 'auto' }
    const moves = arrange([frame, box('a', 0, 0), box('b', 50, 0, 100, 50, { locked: true }), box('c', 90, 0)], new Set(['f', 'a', 'b', 'c']), 'left')
    expect([...moves.keys()]).toEqual(['c'])
  })
})

describe('lines meet the shape as drawn', () => {
  const shape = (kind: string, extra: Partial<Item> = {}): Item => ({ id: 's', kind: 'shape', x: 0, y: 0, w: 200, h: 100, shape: kind, fill: '#60a5fa', stroke: 'none', text: '', ...extra }) as Item

  it('touches a box at its edge, without a gap', () => {
    const hit = attach(note('a', { w: 200, h: 100 }), { x: 500, y: 50 })
    expect(hit.p.x).toBeCloseTo(200)
    expect(hit.p.y).toBeCloseTo(50)
    expect(hit.n).toEqual({ x: 1, y: 0 })
  })

  it('meets an ellipse on its curve, not on the box around it', () => {
    const hit = attach(shape('ellipse'), { x: 300, y: 150 })
    // On the curve: (x - 100)^2 / 100^2 + (y - 50)^2 / 50^2 = 1, and short of the corner of the box.
    expect(((hit.p.x - 100) / 100) ** 2 + ((hit.p.y - 50) / 50) ** 2).toBeCloseTo(1)
    expect(hit.p.x).toBeLessThan(200)
    expect(hit.p.y).toBeLessThan(100)
  })

  it('meets a diamond on its slanted side', () => {
    const hit = attach(shape('diamond'), { x: 300, y: 150 })
    // The lower right side runs from (200, 50) to (100, 100): x / 2 + y = 150 on it.
    expect(hit.p.x / 2 + hit.p.y).toBeCloseTo(150)
  })

  it('meets a triangle at its slope, not at the empty corner of the box', () => {
    const hit = attach(shape('triangle'), { x: -300, y: 0 })
    expect(hit.p.x).toBeGreaterThan(0)
  })

  it('meets an arrow where it is seen: the head, not the shaft it passes', () => {
    // From the middle up and to the right the ray leaves the shaft, enters the head and leaves it again.
    const hit = attach(shape('arrow'), { x: 600, y: -550 })
    expect(hit.p.x).toBeGreaterThan(124)
  })

  it('turns with a turned item', () => {
    const upright = attach(note('a', { w: 200, h: 100 }), { x: 100, y: -500 })
    const turned = attach(note('a', { w: 200, h: 100, rot: 90 }), { x: 100, y: -500 })
    // Turned a quarter, the item stands on its short side: the line from above meets it 100 above the middle, not 50.
    expect(upright.p.y).toBeCloseTo(0)
    expect(turned.p.y).toBeCloseTo(-50)
  })

  it('places the ends of a line on both items', () => {
    const items = new Map<string, Item>([
      ['a', note('a', { x: 0, y: 0, w: 100, h: 100 })],
      ['b', note('b', { x: 300, y: 0, w: 100, h: 100 })],
    ])
    const g = lineGeometry({ id: 'l', kind: 'line', a: { item: 'a', x: 0, y: 0 }, b: { item: 'b', x: 0, y: 0 }, color: 'auto', width: 2, arrow: 'end', curve: false }, items)
    expect(g.a).toEqual({ x: 100, y: 50 })
    expect(g.b).toEqual({ x: 300, y: 50 })
  })
})

describe('growing from the plus', () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 100 })

  it('puts the new item beside the source, the middles in line', () => {
    expect(placeBeside(box(0, 0), 'right', { w: 100, h: 60 }, [box(0, 0)])).toEqual({ x: 190, y: 20 })
    expect(placeBeside(box(0, 0), 'top', { w: 100, h: 60 }, [box(0, 0)])).toEqual({ x: 0, y: -150 })
  })

  it('moves along the side when the place is taken', () => {
    const taken = [box(0, 0), box(190, 0)]
    const at = placeBeside(box(0, 0), 'right', { w: 100, h: 100 }, taken)
    expect(at.x).toBe(190)
    expect(at.y).toBe(130)
  })

  it('makes the chosen kind, a shape keeping the size and colour of the shape it grows from', () => {
    const src = { id: 's', kind: 'shape', x: 0, y: 0, w: 240, h: 90, shape: 'ellipse', fill: '#4ade80', stroke: 'none', text: 'Topic' } as Item
    const made = branchItem(src, { kind: 'shape', shape: 'diamond' }, 'yellow')
    expect(made).toMatchObject({ kind: 'shape', shape: 'diamond', w: 240, h: 90, fill: '#4ade80', text: '' })
    expect(branchItem(src, { kind: 'same' }, 'yellow')).toMatchObject({ kind: 'shape', shape: 'ellipse', text: '' })
    expect(branchItem(src, { kind: 'note' }, 'pink')).toMatchObject({ kind: 'note', color: 'pink' })
    expect(branchItem(src, { kind: 'same' }, 'yellow').id).not.toBe('s')
  })

  it('knows on which side an item lies', () => {
    expect(sideToward(box(0, 0), box(300, 20))).toBe('right')
    expect(sideToward(box(0, 0), box(10, -300))).toBe('top')
  })
})

describe('the background of a board', () => {
  const view = { x: 10, y: 20, zoom: 2 }

  it('follows the account where the board has none of its own', () => {
    expect(effectiveBackground(undefined, true)).toEqual({ pattern: 'dots', color: 'auto' })
    expect(effectiveBackground(undefined, false)).toEqual({ pattern: 'none', color: 'auto' })
    expect(effectiveBackground({ pattern: 'grid', color: 'paper' }, false)).toEqual({ pattern: 'grid', color: 'paper' })
  })

  it('draws each pattern in board units, moving with the view', () => {
    const dots = backgroundStyle({ pattern: 'dots', color: 'auto' }, view)
    expect(dots.backgroundImage).toContain('radial-gradient')
    expect(dots.backgroundSize).toBe('48px 48px')
    expect(dots.backgroundPosition).toBe('10px 20px')
    expect(backgroundStyle({ pattern: 'none', color: 'auto' }, view).backgroundImage).toBe('none')
    expect(backgroundStyle({ pattern: 'lines', color: 'auto' }, view).backgroundSize).toBe('100% 48px')
    expect(String(backgroundStyle({ pattern: 'mm', color: 'auto' }, view).backgroundImage).split('linear-gradient').length - 1).toBe(4)
    expect(String(backgroundStyle({ pattern: 'grid', color: 'auto' }, view).backgroundImage).split('linear-gradient').length - 1).toBe(2)
  })

  it('takes a fixed colour, and darkens the writing on light paper only', () => {
    expect(backgroundStyle({ pattern: 'none', color: 'paper' }, view).backgroundColor).toBe('#ffffff')
    expect(backgroundStyle({ pattern: 'none', color: '#123456' }, view).backgroundColor).toBe('#123456')
    expect(backgroundStyle({ pattern: 'none', color: 'auto' }, view).backgroundColor).toBe('var(--color-board)')
    expect(inkVariables({ pattern: 'none', color: 'paper' })).toEqual({ '--color-mist-100': '#14141a', '--color-board': '#ffffff' })
    expect(inkVariables({ pattern: 'none', color: 'chalk' })).toEqual({ '--color-mist-100': '#f2f2f5', '--color-board': '#1f3b30' })
    expect(inkVariables({ pattern: 'none', color: 'auto' })).toEqual({})
  })

  it('snaps to the grid it shows', () => {
    expect(gridStep('grid')).toEqual({ x: 24, y: 24 })
    expect(gridStep('lines')).toEqual({ x: null, y: 24 })
    expect(gridStep('none')).toEqual({ x: null, y: null })
    expect(gridStep('iso')).toEqual({ x: null, y: null })
  })
})

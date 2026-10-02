/** The arithmetic behind turning, the order things are drawn in, and the PDF writer. */

import { bounds, outer, turn } from './geometry'
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

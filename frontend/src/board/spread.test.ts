/** Laying out the pages of a PDF: where they go, and what was drawn on them. */

import { drawOrder } from './order'
import { canSpread, SPREAD_GAP, spreadColumns, spreadPdf } from './spread'
import type { Item } from './types'

const pdf = (extra: Partial<Item> = {}): Item => ({ id: 'pdf', kind: 'file', x: 100, y: 50, w: 300, h: 400, media: 'm', name: 'a.pdf', ext: 'pdf', sizeLabel: '1 KB', pages: 3, page: 2, ...extra }) as Item
const ink = (id: string, page: number, on = 'pdf'): Item => ({ id, kind: 'ink', x: 120, y: 60, w: 10, h: 10, ow: 10, oh: 10, points: [], color: 'auto', size: 3, on: { item: on, page } })
const counter = () => {
  let n = 0
  return () => 'new' + ++n
}

describe('laying out the pages of a PDF', () => {
  it('only offers it for a PDF of more than one page', () => {
    expect(canSpread(pdf())).toBe(true)
    expect(canSpread(pdf({ pages: 1 } as Partial<Item>))).toBe(false)
    expect(canSpread(pdf({ pages: undefined } as Partial<Item>))).toBe(false)
    expect(canSpread(pdf({ ext: 'docx' } as Partial<Item>))).toBe(false)
    expect(spreadPdf([pdf({ pages: 1 } as Partial<Item>)], 'pdf', counter())).toBeNull()
  })

  it('puts up to four pages in a row, more in a block', () => {
    expect([1, 2, 3, 4, 5, 9, 10, 20].map(spreadColumns)).toEqual([1, 2, 3, 4, 3, 3, 4, 5])
  })

  it('keeps the PDF on page one and puts every further page beside it', () => {
    const out = spreadPdf([pdf()], 'pdf', counter())!
    expect(out.map((i) => [i.id, i.kind === 'file' && i.page, i.x, i.y])).toEqual([
      ['pdf', 1, 100, 50],
      ['new1', 2, 100 + 300 + SPREAD_GAP, 50],
      ['new2', 3, 100 + 2 * (300 + SPREAD_GAP), 50],
    ])
    expect(out.every((i) => i.w === 300 && i.h === 400)).toBe(true)
  })

  it('starts a new row after the last column', () => {
    const out = spreadPdf([pdf({ pages: 5 } as Partial<Item>)], 'pdf', counter())!
    const fifth = out.find((i) => i.kind === 'file' && i.page === 5)!
    expect([fifth.x, fifth.y]).toEqual([100 + 300 + SPREAD_GAP, 50 + 400 + SPREAD_GAP])
  })

  it('stacks the new pages right above the PDF, under what lay above it', () => {
    const note = { id: 'note', kind: 'note', x: 0, y: 0, w: 10, h: 10, color: 'yellow', text: '' } as Item
    const out = spreadPdf([pdf(), note], 'pdf', counter())!
    expect(out.map((i) => i.id)).toEqual(['pdf', 'new1', 'new2', 'note'])
  })

  it('moves what was drawn on a page along with its page', () => {
    const out = spreadPdf([pdf(), ink('on1', 1), ink('on2', 2), ink('on3', 3), ink('other', 2, 'else')], 'pdf', counter())!
    const byId = new Map(out.map((i) => [i.id, i]))
    expect(byId.get('on1')).toMatchObject({ x: 120, y: 60, on: { item: 'pdf', page: 1 } })
    expect(byId.get('on2')).toMatchObject({ x: 120 + 300 + SPREAD_GAP, y: 60, on: { item: 'new1', page: 2 } })
    expect(byId.get('on3')).toMatchObject({ x: 120 + 2 * (300 + SPREAD_GAP), y: 60, on: { item: 'new2', page: 3 } })
    expect(byId.get('other')).toMatchObject({ x: 120, on: { item: 'else', page: 2 } })
    // Every drawing shows: each lies on the page its item shows now.
    expect(drawOrder(out).map((i) => i.id)).toEqual(expect.arrayContaining(['on1', 'on2', 'on3']))
  })
})

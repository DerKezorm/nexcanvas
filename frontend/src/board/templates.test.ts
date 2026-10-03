/** The template catalogue: every template builds a sound board in both languages; "only the frame" keeps the frame. */

import { makeLookup } from './library/registry'
import { CATALOG, CATEGORIES, catalogDoc, skeleton } from './templates'
import type { Doc } from './types'

const say = (key: string) => key

describe('the shipped templates', () => {
  it('fill every group and are named once', () => {
    const ids = CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const category of CATEGORIES) expect(CATALOG.some((c) => c.category === category), category).toBe(true)
    expect(CATALOG.length).toBeGreaterThanOrEqual(30)
  })

  it.each(['de', 'en'])('build sound boards in %s', (language) => {
    const lookup = makeLookup()
    for (const { id } of CATALOG) {
      const doc = catalogDoc(id, say, language)
      if (id !== 'blank') expect(doc.items.length, id).toBeGreaterThan(0)
      const items = new Set(doc.items.map((i) => i.id))
      expect(items.size, `${id}: ids once`).toBe(doc.items.length)
      for (const line of doc.lines) {
        if (line.a.item) expect(items.has(line.a.item), `${id}: line start`).toBe(true)
        if (line.b.item) expect(items.has(line.b.item), `${id}: line end`).toBe(true)
      }
      for (const item of doc.items) {
        if (item.kind === 'shape' && item.lib) expect(lookup(item.lib), `${id}: ${item.lib}`).toBeDefined()
        expect([item.x, item.y, item.w, item.h].every(Number.isFinite), `${id}: place`).toBe(true)
      }
    }
  })

  it('speak the language of the page', () => {
    const de = JSON.stringify(catalogDoc('swot', say, 'de'))
    const en = JSON.stringify(catalogDoc('swot', say, 'en'))
    expect(de).toContain('Stärken')
    expect(en).toContain('Strengths')
  })

  it('give floor plans millimetre paper', () => {
    expect(catalogDoc('flat', say, 'de').background).toEqual({ pattern: 'mm', color: 'paper' })
  })
})

describe('only the frame', () => {
  it('keeps frames, shapes, texts and their lines, and drops notes with the lines to them', () => {
    const doc: Doc = {
      items: [
        { id: 'f', kind: 'frame', x: 0, y: 0, w: 10, h: 10, title: 'A', color: '#fff' },
        { id: 's', kind: 'shape', x: 0, y: 0, w: 10, h: 10, shape: 'rect', fill: 'none', stroke: 'none', text: 'Head' },
        { id: 'n', kind: 'note', x: 0, y: 0, w: 10, h: 10, color: 'yellow', text: 'mine' },
      ],
      lines: [
        { id: 'l1', kind: 'line', a: { item: 's', x: 0, y: 0 }, b: { item: 'f', x: 0, y: 0 }, color: 'auto', width: 2, arrow: 'end', curve: false },
        { id: 'l2', kind: 'line', a: { item: 's', x: 0, y: 0 }, b: { item: 'n', x: 0, y: 0 }, color: 'auto', width: 2, arrow: 'end', curve: false },
      ],
      background: { pattern: 'grid', color: 'auto' },
    }
    const bare = skeleton(doc)
    expect(bare.items.map((i) => i.id)).toEqual(['f', 's'])
    expect(bare.lines.map((l) => l.id)).toEqual(['l1'])
    expect(bare.background).toEqual({ pattern: 'grid', color: 'auto' })
  })
})

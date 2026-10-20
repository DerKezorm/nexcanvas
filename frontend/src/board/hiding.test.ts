import { covered, hiddenIds, hiddenLine, hidingFrames, mayShow, shownOf } from './hiding'
import type { FrameItem, Item, LineItem } from './types'

interface Case {
  name: string
  items: Item[]
  lines: LineItem[]
  hidden: string[]
  hiddenLines: string[]
}

// The same cases the server is tested against, so both draw the line in the same place. Read with Node's own module,
// without its types in the app's build (the tests run in Node), from the frontend folder, where the tests run.
const fs = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ fs)) as { readFileSync: (file: string, encoding: string) => string }
const cases = (JSON.parse(readFileSync('../backend/tests/hiding_cases.json', 'utf-8')) as { cases: Case[] }).cases

describe('what a hidden frame covers, as the server sees it', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const hidden = hiddenIds(c.items)
    expect([...hidden].sort()).toEqual(c.hidden)
    const frames = hidingFrames(c.items)
    expect(c.lines.filter((line) => hiddenLine(line, hidden, frames)).map((line) => line.id).sort()).toEqual(c.hiddenLines)
  })
})

describe('what is covered on a screen', () => {
  const frame: FrameItem = { id: 'frame1', kind: 'frame', x: 0, y: 0, w: 400, h: 300, title: '', color: '#ff8a70', hidden: true, hiddenBy: 7 }
  const note: Item = { id: 'note01', kind: 'note', x: 50, y: 50, w: 100, h: 100, color: 'yellow', text: '42' }

  it('is everything hidden, for whoever hid it too (a projector shows that screen to the class)', () => {
    expect([...covered([frame, note], []).items]).toEqual(['note01'])
    expect(shownOf({ items: [frame, note], lines: [] }).items.map((i) => i.id)).toEqual(['frame1'])
  })

  it('opens only the frames looked into on this screen', () => {
    expect(covered([frame, note], [], new Set(['frame1'])).items.size).toBe(0)
  })

  it('lets whoever hid it and who manages the space show it or look inside', () => {
    expect(mayShow(frame, 7, 'write')).toBe(true)
    expect(mayShow(frame, 8, 'manage')).toBe(true)
    expect(mayShow(frame, 8, 'write')).toBe(false)
    expect(mayShow(frame, undefined, 'read')).toBe(false)
  })
})

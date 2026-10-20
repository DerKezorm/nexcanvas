import { covered, hiddenIds, hiddenLine, hidingFrames, seesInside } from './hiding'
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

describe('who sees inside', () => {
  const frame: FrameItem = { id: 'frame1', kind: 'frame', x: 0, y: 0, w: 400, h: 300, title: '', color: '#ff8a70', hidden: true, hiddenBy: 7 }
  const note: Item = { id: 'note01', kind: 'note', x: 50, y: 50, w: 100, h: 100, color: 'yellow', text: '42' }

  it('is whoever hid it and who manages the space', () => {
    expect(seesInside(frame, 7, 'write')).toBe(true)
    expect(seesInside(frame, 8, 'manage')).toBe(true)
    expect(seesInside(frame, 8, 'write')).toBe(false)
    expect(seesInside(frame, undefined, 'read')).toBe(false)
  })

  it('covers for the others only', () => {
    expect([...covered([frame, note], [], 8, 'write').items]).toEqual(['note01'])
    expect(covered([frame, note], [], 7, 'write').items.size).toBe(0)
  })
})

import { alignOf, baseOf, boldOf, chosenSize, lookKey, lookOn, lookStyle, sized, textSizeOf, toggled } from './textLook'
import type { NoteItem, ShapeItem, TextItem } from './types'

const box = { id: 'item01', x: 0, y: 0, w: 100, h: 40 }
const text = (more: Partial<TextItem> = {}): TextItem => ({ ...box, kind: 'text', text: 'Hi', size: 'm', color: 'auto', ...more })
const shape: ShapeItem = { ...box, kind: 'shape', shape: 'rect', fill: 'blue', stroke: 'none', text: 'A' }
const note: NoteItem = { ...box, kind: 'note', text: 'B', color: 'yellow' }

describe('the look of words', () => {
  it('sits on the left, on a shape in the middle, unless chosen', () => {
    expect(alignOf(text())).toBe('left')
    expect(alignOf(note)).toBe('left')
    expect(alignOf(shape)).toBe('center')
    expect(alignOf({ ...shape, align: 'right' })).toBe('right')
    expect(lookStyle(text({ align: 'center' })).textAlign).toBe('center')
  })

  it('has the size chosen for it, else the kind decides; nothing odd counts as chosen', () => {
    expect(chosenSize(note)).toBeNull()
    expect(chosenSize({ ...note, fontSize: 14 })).toBe(14)
    expect(textSizeOf(text())).toBe(20)
    expect(textSizeOf(text({ size: 'xl' }))).toBe(44)
    expect(textSizeOf(text({ size: 'xl', fontSize: 12 }))).toBe(12)
    for (const odd of [0, 5, 201, Number.NaN, Infinity]) expect(chosenSize({ ...note, fontSize: odd })).toBeNull()
  })

  it('never makes words bold or plain by their size alone', () => {
    expect(sized(text({ size: 'xl' }), 14)).toEqual({ fontSize: 14, bold: true })
    expect(sized(text({ size: 'xl', bold: false }), 14)).toEqual({ fontSize: 14 })
    expect(sized(text(), 30)).toEqual({ fontSize: 30 })
    expect(sized(note, null)).toEqual({ fontSize: undefined })
  })

  it('is bold for large texts until someone switches it off', () => {
    expect(boldOf(text({ size: 'xl' }))).toBe(true)
    expect(boldOf(text({ size: 'xl', bold: false }))).toBe(false)
    expect(toggled(text({ size: 'l' }), 'bold')).toEqual({ bold: false })
    expect(toggled(text(), 'bold')).toEqual({ bold: true })
  })

  it('counts a look as on when every letter carries it, not when a part does', () => {
    const all = text({ rich: [{ insert: 'Hi', attributes: { italic: true } }] })
    const part = text({ text: 'Hi you', rich: [{ insert: 'Hi', attributes: { italic: true } }, { insert: ' you' }] })
    expect(lookOn(all, 'italic')).toBe(true)
    expect(toggled(all, 'italic')).toEqual({ italic: false })
    expect(lookOn(part, 'italic')).toBe(false)
    expect(toggled(part, 'italic')).toEqual({ italic: true })
    expect(baseOf(all, 'italic')).toBe(false)
  })

  it('underlines and strikes through at once', () => {
    expect(lookStyle(text({ underline: true, strike: true, italic: true }))).toMatchObject({ textDecorationLine: 'underline line-through', fontStyle: 'italic' })
    expect(lookStyle(text()).textDecorationLine).toBeUndefined()
  })

  it('knows its keys', () => {
    const key = (k: string, more = {}) => lookKey({ key: k, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...more })
    expect(key('b')).toBe('bold')
    expect(key('I')).toBe('italic')
    expect(key('u')).toBe('underline')
    expect(key('X', { shiftKey: true })).toBe('strike')
    expect(key('x')).toBeNull()
    expect(lookKey({ key: 'b', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBeNull()
  })
})

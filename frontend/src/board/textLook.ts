/**
 * The look of an item's words: alignment, bold, italic, underlined, struck through. It is set for all words of an
 * item at once (the words themselves stay plain text, so two people can type in them together).
 */

import type { CSSProperties } from 'react'

import type { Item, NoteItem, ShapeItem, TextAlign, TextItem, TextLook } from './types'

export type Worded = NoteItem | ShapeItem | TextItem

export function hasWords(item: Item): item is Worded {
  return item.kind === 'note' || item.kind === 'shape' || item.kind === 'text'
}

/** Where the words of a kind sit when nobody chose: on a shape in the middle, elsewhere on the left. */
export function alignOf(item: Worded): TextAlign {
  return item.align ?? (item.kind === 'shape' ? 'center' : 'left')
}

/** Bold when chosen; when not, a text of size L or XL is bold, and a shape's words are a little heavier. */
export function boldOf(item: Worded): boolean {
  if (item.bold !== undefined) return item.bold
  return item.kind === 'text' && (item.size === 'l' || item.size === 'xl')
}

export function lookStyle(item: Worded): CSSProperties {
  const lines = [item.underline && 'underline', item.strike && 'line-through'].filter(Boolean).join(' ')
  return {
    textAlign: alignOf(item),
    fontWeight: boldOf(item) ? 700 : item.kind === 'shape' ? 500 : 400,
    fontStyle: item.italic ? 'italic' : undefined,
    textDecorationLine: lines || undefined,
  }
}

/** The flex placement that puts a block of words where its alignment says. */
export function justifyOf(item: Worded): CSSProperties['justifyContent'] {
  const align = alignOf(item)
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
}

/** A key with Ctrl (or Cmd) that switches a look: B, I, U, and Shift X for struck through. */
export function lookKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): keyof TextLook | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (!e.shiftKey && key === 'b') return 'bold'
  if (!e.shiftKey && key === 'i') return 'italic'
  if (!e.shiftKey && key === 'u') return 'underline'
  if (e.shiftKey && key === 'x') return 'strike'
  return null
}

/** The change that switches one look of an item: the opposite of what it shows now. */
export function toggled(item: Worded, look: Exclude<keyof TextLook, 'align'>): Partial<TextLook> {
  const now = look === 'bold' ? boldOf(item) : !!item[look]
  return { [look]: !now }
}

/**
 * The look of an item's words as a whole: alignment, bold, italic, underlined, struck through. Parts of the words
 * can carry their own (`board/rich.ts`); a look counts as on for the item when the item has it or every letter does.
 */

import type { CSSProperties } from 'react'

import { allHave, FONT_MAX, FONT_MIN, type SpanLook } from './rich'
import type { Item, NoteItem, ShapeItem, TextAlign, TextItem, TextLook, TextSize } from './types'

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
export function lookKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): SpanLook | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (!e.shiftKey && key === 'b') return 'bold'
  if (!e.shiftKey && key === 'i') return 'italic'
  if (!e.shiftKey && key === 'u') return 'underline'
  if (e.shiftKey && key === 'x') return 'strike'
  return null
}

/** The item itself has the look, for all its words (unlike parts of them). */
export function baseOf(item: Worded, look: SpanLook): boolean {
  return look === 'bold' ? boldOf(item) : !!item[look]
}

/** The look shows on all of the item's words: the item has it, or every letter does. */
export function lookOn(item: Worded, look: SpanLook): boolean {
  return baseOf(item, look) || allHave(item.rich, look)
}

/**
 * The change that switches one look of an item: the opposite of what it shows now. Switching off also has to take
 * the look from the parts that carry it (`clearWords`), or they would keep showing it.
 */
export function toggled(item: Worded, look: SpanLook): Partial<TextLook> {
  return { [look]: !lookOn(item, look) }
}

/** The steps of a text, in pixels, when no size was chosen for it. */
export const TEXT_SIZES: Record<TextSize, number> = { s: 15, m: 20, l: 28, xl: 44 }

/**
 * The size chosen for all of an item's words, in pixels, or null when the kind decides: a note or a shape fits its
 * words in, a text has its step (S to XL).
 */
export function chosenSize(item: Worded): number | null {
  const n = Number(item.fontSize)
  return item.fontSize !== undefined && Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? Math.round(n) : null
}

/** The size a text's words are drawn in: the one chosen, else its step. */
export function textSizeOf(item: TextItem): number {
  return chosenSize(item) ?? TEXT_SIZES[item.size] ?? TEXT_SIZES.m
}

/**
 * The change that gives an item's words one size (null: the kind's own again). A text that is bold by its step stays
 * bold, so a size alone never makes words bold or plain.
 */
export function sized(item: Worded, size: number | null): Partial<TextLook> {
  const change: Partial<TextLook> = { fontSize: size ?? undefined }
  if (item.bold === undefined && boldOf(item)) change.bold = true
  return change
}

import { bounds, center, contains, type Rect } from './geometry'
import type { FrameItem, Item } from './types'

/** Drawings made on a PDF page that is not the one showing now: they wait until the page comes back. */
export function waitingInk(items: Item[]): Set<string> {
  const pages = new Map<string, number>()
  for (const item of items) if (item.kind === 'file') pages.set(item.id, item.page ?? 1)
  const hidden = new Set<string>()
  for (const item of items) {
    if (item.kind === 'ink' && item.on && pages.has(item.on.item) && pages.get(item.on.item) !== item.on.page) hidden.add(item.id)
  }
  return hidden
}

/** Whether `frame` was drawn onto `item`: the item holds the frame's middle, and the item's own middle lies outside the
 * frame (else the item lies in the frame). A frame around a part of a PDF or a photo sits on it. */
export function sitsOn(frame: Item, item: Item): boolean {
  return contains(item, center(frame)) && !contains(frame, center(item))
}

/**
 * What is drawn, in the order it is drawn, drawings of other PDF pages left out. A frame lies under what lies in it,
 * but over what it was drawn onto (`sitsOn`), so it can be picked there and covers that part when hidden; frames that
 * sit on nothing lie under everything. Of two frames the larger lies under. The same on the board, on the public page
 * and in the overview's little pictures (the server's picture follows the same rule, `picture.draw_order`).
 */
export function drawOrder(items: Item[], waiting: Set<string> = waitingInk(items)): Item[] {
  const rest = items.filter((i) => i.kind !== 'frame' && !waiting.has(i.id))
  const frames = items.filter((i) => i.kind === 'frame').sort((a, b) => b.w * b.h - a.w * a.h)
  // Each frame goes right after the last item it sits on; -1 is under everything.
  const after = new Map<number, Item[]>()
  for (const frame of frames) {
    let at = -1
    rest.forEach((item, n) => {
      if (sitsOn(frame, item)) at = n
    })
    after.set(at, [...(after.get(at) ?? []), frame])
  }
  const out = [...(after.get(-1) ?? [])]
  rest.forEach((item, n) => out.push(item, ...(after.get(n) ?? [])))
  return out
}

/** Frames in reading order: rows from top to bottom, in a row from left to right. Presenting goes this way. */
export function framesInOrder(items: Item[]): FrameItem[] {
  const frames = items.filter((i): i is FrameItem => i.kind === 'frame')
  return frames.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x))
}

/** Room between a frame made around items and the items, on every side. */
export const FRAME_PAD = 24

/** The box of a frame around `items`: their bounds, turned ones by the box they cover, with `FRAME_PAD` around. */
export function frameAround(items: Item[]): Rect | null {
  const box = bounds(items)
  if (!box) return null
  return { x: box.x - FRAME_PAD, y: box.y - FRAME_PAD, w: box.w + 2 * FRAME_PAD, h: box.h + 2 * FRAME_PAD }
}

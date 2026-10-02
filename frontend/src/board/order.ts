import type { Item } from './types'

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

/** What is drawn, in the order it is drawn: frames under everything, drawings of other PDF pages left out. The same
 * on the board, on the public page and in the overview's little pictures. */
export function drawOrder(items: Item[], waiting: Set<string> = waitingInk(items)): Item[] {
  return [...items.filter((i) => i.kind === 'frame'), ...items.filter((i) => i.kind !== 'frame' && !waiting.has(i.id))]
}

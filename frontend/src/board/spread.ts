/**
 * Laying out every page of a PDF on the board, as Miro does. The PDF keeps its place and shows the first page; each
 * further page becomes a PDF item of its own beside it, in rows, the same size, right above it in the stacking order.
 * What was drawn on a page goes along with that page.
 */

import type { FileItem, Item } from './types'

/** The room between two pages laid out, on the board. */
export const SPREAD_GAP = 24

/** How many pages stand side by side: up to four in one row, more in a square-ish block. */
export function spreadColumns(pages: number): number {
  return pages <= 4 ? pages : Math.ceil(Math.sqrt(pages))
}

export function canSpread(item: Item): item is FileItem {
  return item.kind === 'file' && item.ext === 'pdf' && (item.pages ?? 0) > 1
}

/** The board's items with the pages of the PDF `id` laid out, or null when it is no PDF of several pages. */
export function spreadPdf(items: Item[], id: string, newId: () => string): Item[] | null {
  const pdf = items.find((i) => i.id === id)
  if (!pdf || !canSpread(pdf)) return null
  const pages = pdf.pages ?? 1
  const columns = spreadColumns(pages)
  const ids = new Map<number, string>()
  const place = new Map<number, { x: number; y: number }>()
  for (let page = 1; page <= pages; page++) {
    const n = page - 1
    place.set(page, { x: pdf.x + (n % columns) * (pdf.w + SPREAD_GAP), y: pdf.y + Math.floor(n / columns) * (pdf.h + SPREAD_GAP) })
    if (page > 1) ids.set(page, newId())
  }
  const copies: Item[] = [...ids].map(([page, copyId]) => ({ ...pdf, id: copyId, page, ...place.get(page)! }))
  const out: Item[] = []
  for (const item of items) {
    if (item.id === id) {
      out.push({ ...pdf, page: 1 }, ...copies)
      continue
    }
    // A drawing on a page moves as far as its page did, and belongs to the page's own item from now on.
    if (item.kind === 'ink' && item.on?.item === id && item.on.page > 1 && ids.has(item.on.page)) {
      const to = place.get(item.on.page)!
      out.push({ ...item, x: item.x + to.x - pdf.x, y: item.y + to.y - pdf.y, on: { item: ids.get(item.on.page)!, page: item.on.page } })
      continue
    }
    out.push(item)
  }
  return out
}

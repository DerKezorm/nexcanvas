/**
 * Frames whose content is hidden, as a teacher hides the answers until it is time. The same rule as the server's
 * (`backend/app/services/hiding.py`), tested against the same cases (`backend/tests/hiding_cases.json`).
 *
 * Who may only read never gets hidden content from the server. Who may write has it in the board, and the page
 * covers it, except for whoever hid the frame and those who manage the space.
 */

import { contains } from './geometry'
import type { FrameItem, Item, LineItem, Role } from './types'

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function hidingFrames(items: Item[]): FrameItem[] {
  return items.filter((i): i is FrameItem => i.kind === 'frame' && i.hidden === true)
}

/** The ids of every item that lies hidden in one of `frames`. */
export function hiddenIds(items: Item[], frames: FrameItem[] = hidingFrames(items)): Set<string> {
  const hidden = new Set<string>()
  if (!frames.length) return hidden
  for (const item of items) {
    const w = num(item.w)
    const h = num(item.h)
    const middle = { x: num(item.x) + w / 2, y: num(item.y) + h / 2 }
    for (const frame of frames) {
      if (item.id === frame.id) continue
      // A frame at least as large is no content of this one (it is the other way round).
      if (item.kind === 'frame' && w * h >= num(frame.w) * num(frame.h)) continue
      if (contains(frame, middle)) {
        hidden.add(item.id)
        break
      }
    }
  }
  // Drawn on a page of a PDF that is hidden: hidden with it, wherever its middle lies.
  for (const item of items) if (item.kind === 'ink' && item.on && hidden.has(item.on.item)) hidden.add(item.id)
  return hidden
}

export function hiddenLine(line: LineItem, hidden: Set<string>, frames: FrameItem[]): boolean {
  for (const end of [line.a, line.b]) {
    if (!end) continue
    if (end.item) {
      if (hidden.has(end.item)) return true
    } else if (frames.some((frame) => contains(frame, { x: num(end.x), y: num(end.y) }))) return true
  }
  return false
}

/** Whether this person sees what a hidden frame holds: whoever hid it, and those who manage the space. */
export function seesInside(frame: FrameItem, me: number | undefined, role: Role | null | undefined): boolean {
  return role === 'manage' || (me !== undefined && frame.hiddenBy === me)
}

/** A board's items and lines without what is covered for this person (the overview, the files). */
export function shownOf(board: { items: Item[]; lines: LineItem[]; role?: Role | null }, me: number | undefined): { items: Item[]; lines: LineItem[] } {
  const hidden = covered(board.items, board.lines, me, board.role)
  if (!hidden.items.size && !hidden.lines.size) return board
  return { items: board.items.filter((i) => !hidden.items.has(i.id)), lines: board.lines.filter((l) => !hidden.lines.has(l.id)) }
}

/** What is covered for this person: the items and lines in the hidden frames they do not see into. */
export function covered(items: Item[], lines: LineItem[], me: number | undefined, role: Role | null | undefined): { items: Set<string>; lines: Set<string> } {
  const frames = hidingFrames(items).filter((frame) => !seesInside(frame, me, role))
  if (!frames.length) return { items: new Set(), lines: new Set() }
  const ids = hiddenIds(items, frames)
  return { items: ids, lines: new Set(lines.filter((line) => hiddenLine(line, ids, frames)).map((line) => line.id)) }
}

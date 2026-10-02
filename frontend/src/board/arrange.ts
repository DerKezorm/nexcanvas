import { bounds, type Rect } from './geometry'
import type { Item } from './types'

export type Arrange = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'spreadX' | 'spreadY'

/**
 * How far each selected item moves to line up or spread out. A group moves as one block, so its inner layout stays;
 * a turned item counts with the box it covers. Frames and locked items stay where they are.
 */
export function arrange(items: Item[], selected: Set<string>, how: Arrange): Map<string, { dx: number; dy: number }> {
  const chosen = items.filter((i) => selected.has(i.id) && !i.locked && i.kind !== 'frame')
  // Blocks: each group once, each single item alone.
  const blocks = new Map<string, Item[]>()
  for (const item of chosen) {
    const key = item.group ? 'g:' + item.group : 'i:' + item.id
    blocks.set(key, [...(blocks.get(key) ?? []), item])
  }
  const units = [...blocks.values()].map((members) => ({ members, box: bounds(members) as Rect }))
  const moves = new Map<string, { dx: number; dy: number }>()
  if (units.length < 2) return moves
  const all = bounds(units.map((u) => u.box)) as Rect
  const shift = (unit: (typeof units)[number], dx: number, dy: number) => {
    for (const member of unit.members) if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) moves.set(member.id, { dx, dy })
  }

  if (how === 'spreadX' || how === 'spreadY') {
    if (units.length < 3) return moves
    const horizontal = how === 'spreadX'
    const start = (r: Rect) => (horizontal ? r.x : r.y)
    const size = (r: Rect) => (horizontal ? r.w : r.h)
    const sorted = [...units].sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2))
    const first = sorted[0].box
    const last = sorted[sorted.length - 1].box
    const room = start(last) + size(last) - start(first) - sorted.reduce((sum, u) => sum + size(u.box), 0)
    const gap = room / (sorted.length - 1)
    let at = start(first)
    for (const unit of sorted) {
      const d = at - start(unit.box)
      shift(unit, horizontal ? d : 0, horizontal ? 0 : d)
      at += size(unit.box) + gap
    }
    return moves
  }

  for (const unit of units) {
    const r = unit.box
    switch (how) {
      case 'left':
        shift(unit, all.x - r.x, 0)
        break
      case 'centerX':
        shift(unit, all.x + all.w / 2 - (r.x + r.w / 2), 0)
        break
      case 'right':
        shift(unit, all.x + all.w - (r.x + r.w), 0)
        break
      case 'top':
        shift(unit, 0, all.y - r.y)
        break
      case 'centerY':
        shift(unit, 0, all.y + all.h / 2 - (r.y + r.h / 2))
        break
      case 'bottom':
        shift(unit, 0, all.y + all.h - (r.y + r.h))
        break
    }
  }
  return moves
}

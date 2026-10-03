/**
 * Growing a mind map from an item, as with the "+" beside it: what to add (the same again, a note, a text or any
 * shape), where it goes (beside the item on that side, or where the "+" was dropped), and not on top of what is
 * already there: a second child on the same side moves along until the place is free.
 */
import { center, intersects, type Point, type Rect } from './geometry'
import type { Item, NoteColor, ShapeKind } from './types'

export type Side = 'top' | 'right' | 'bottom' | 'left'

export type BranchChoice = { kind: 'same' } | { kind: 'note' } | { kind: 'text' } | { kind: 'shape'; shape: ShapeKind }

/** The room between an item and what grows out of it. */
export const BRANCH_GAP = 90

const uid = () => Math.random().toString(36).slice(2, 10)

/** A key for a choice, to remember the ones used last. */
export function choiceKey(choice: BranchChoice): string {
  return choice.kind === 'shape' ? `shape:${choice.shape}` : choice.kind
}

export function choiceFromKey(key: string): BranchChoice | null {
  if (key === 'same' || key === 'note' || key === 'text') return { kind: key }
  if (key.startsWith('shape:')) return { kind: 'shape', shape: key.slice(6) as ShapeKind }
  return null
}

/** The new item, of the chosen kind and at its size, at 0,0; placing comes after. */
export function branchItem(src: Item, choice: BranchChoice, note: NoteColor): Item {
  const id = uid()
  if (choice.kind === 'same' && (src.kind === 'note' || src.kind === 'shape' || src.kind === 'text')) {
    return { ...src, id, x: 0, y: 0, rot: undefined, group: undefined, locked: false, text: '' } as Item
  }
  if (choice.kind === 'text') return { id, kind: 'text', x: 0, y: 0, w: 220, h: 30, text: '', size: 'm', color: 'auto' }
  if (choice.kind === 'shape') {
    const like = src.kind === 'shape' ? src : null
    return { id, kind: 'shape', x: 0, y: 0, w: like?.w ?? 160, h: like?.h ?? 110, shape: choice.shape, fill: like?.fill ?? '#60a5fa', stroke: like?.stroke ?? 'none', text: '' }
  }
  return { id, kind: 'note', x: 0, y: 0, w: 180, h: 180, color: src.kind === 'note' ? src.color : note, text: '' }
}

/** Which side of `from` the item `to` lies on, by the larger distance between their middles. */
export function sideToward(from: Rect, to: Rect): Side {
  const a = center(from)
  const b = center(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/**
 * Where a new box of `size` goes beside `src` on `side`: right next to it, the middles in line, and when something is
 * there already, moved along the side (down, then up, then further) until it lies free.
 */
export function placeBeside(src: Rect, side: Side, size: { w: number; h: number }, items: Rect[], gap = BRANCH_GAP): Point {
  const c = center(src)
  const start =
    side === 'right'
      ? { x: src.x + src.w + gap, y: c.y - size.h / 2 }
      : side === 'left'
        ? { x: src.x - gap - size.w, y: c.y - size.h / 2 }
        : side === 'bottom'
          ? { x: c.x - size.w / 2, y: src.y + src.h + gap }
          : { x: c.x - size.w / 2, y: src.y - gap - size.h }
  const along = side === 'left' || side === 'right' ? { x: 0, y: size.h + 30 } : { x: size.w + 30, y: 0 }
  for (let n = 0; n < 24; n++) {
    // 0, 1, -1, 2, -2 ...: the nearest free place along the side.
    const k = n === 0 ? 0 : n % 2 === 1 ? (n + 1) / 2 : -n / 2
    const at = { x: start.x + along.x * k, y: start.y + along.y * k }
    const box = { x: at.x - 8, y: at.y - 8, w: size.w + 16, h: size.h + 16 }
    if (!items.some((other) => intersects(box, other))) return at
  }
  return start
}

/** Small decisions of the board's pointer, kept apart so they can be tested without a browser. */

type Lockable = { id: string; locked?: boolean }

/** How long after the middle button a paste counts as the button's own (Linux) and not as one somebody asked for. */
export const MIDDLE_PASTE_MS = 1000

/** How far a press may wander, in screen pixels, and still be a click. */
export const CLICK_PX = 4

/** One notch of a mouse wheel with Ctrl: ten percent, however much the wheel reports. */
const WHEEL_NOTCH = Math.log(1.1)

/** A trackpad pinch sends small steps, which add up; one step is taken as it comes, up to a notch. */
const PINCH_STEP = 0.01

/** What one wheel event with Ctrl, or one step of a pinch, multiplies the zoom by. */
export function wheelZoom(deltaY: number): number {
  return Math.exp(-Math.sign(deltaY) * Math.min(Math.abs(deltaY) * PINCH_STEP, WHEEL_NOTCH))
}

/**
 * What a drag on the empty board does with the select tool: it draws a box around what to select (with Shift, added to
 * what is selected). The board moves with the right or the middle button. A finger has neither, so it moves the board.
 */
export function emptyDrag(pointer: string): 'pan' | 'marquee' {
  return pointer === 'touch' ? 'pan' : 'marquee'
}

/** Whether a press let go where it began. */
export function stayed(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) < CLICK_PX
}

/** What of `ids` is not locked. Lines cannot be locked, so they stay. */
export function unlocked(ids: string[], items: Lockable[]): string[] {
  const locked = new Set(items.filter((i) => i.locked).map((i) => i.id))
  return ids.filter((id) => !locked.has(id))
}

/** Whether a drag on `ids` would find nothing to take hold of. */
export function onlyLocked(ids: string[], items: Lockable[]): boolean {
  return ids.length > 0 && unlocked(ids, items).length === 0
}

/**
 * Whether a paste came from the middle button: Firefox on Linux pastes the last marked words on that button, whatever
 * the desktop says, and on the board the button moves the board. Both times are event times in milliseconds.
 */
export function pastedByMiddle(pasteAt: number, middleAt: number): boolean {
  return pasteAt - middleAt < MIDDLE_PASTE_MS
}

/** Small decisions of the board's pointer, kept apart so they can be tested without a browser. */

/** How long after the middle button a paste counts as the button's own (Linux) and not as one somebody asked for. */
export const MIDDLE_PASTE_MS = 1000

/**
 * What a drag on the empty board does with the select tool: it moves the board, as the hand does; with Shift it draws
 * a box around what to select. A finger always moves the board (Shift is no key on a touch screen).
 */
export function emptyDrag(shift: boolean, pointer: string): 'pan' | 'marquee' {
  return shift && pointer !== 'touch' ? 'marquee' : 'pan'
}

/**
 * Whether a paste came from the middle button: Firefox on Linux pastes the last marked words on that button, whatever
 * the desktop says, and on the board the button moves the board. Both times are event times in milliseconds.
 */
export function pastedByMiddle(pasteAt: number, middleAt: number): boolean {
  return pasteAt - middleAt < MIDDLE_PASTE_MS
}

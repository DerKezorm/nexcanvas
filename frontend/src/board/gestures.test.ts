/** What a drag on the empty board does, and which pastes are the middle button's (Discussion #1, 0.8.0). */

import { MIDDLE_PASTE_MS, emptyDrag, pastedByMiddle } from './gestures'

describe('a drag on the empty board with the select tool', () => {
  it('moves the board, with a mouse, a pen and a finger', () => {
    expect(emptyDrag(false, 'mouse')).toBe('pan')
    expect(emptyDrag(false, 'pen')).toBe('pan')
    expect(emptyDrag(false, 'touch')).toBe('pan')
  })

  it('draws a box to select several with Shift held', () => {
    expect(emptyDrag(true, 'mouse')).toBe('marquee')
    expect(emptyDrag(true, 'pen')).toBe('marquee')
    expect(emptyDrag(true, 'touch')).toBe('pan')
  })
})

describe('a paste on the board', () => {
  it('is dropped right after the middle button, which pastes by itself on Linux', () => {
    expect(pastedByMiddle(5000, 4990)).toBe(true)
    expect(pastedByMiddle(5000, 5000 - MIDDLE_PASTE_MS + 1)).toBe(true)
  })

  it('goes through a while later, and when the middle button was never pressed', () => {
    expect(pastedByMiddle(5000, 5000 - MIDDLE_PASTE_MS)).toBe(false)
    expect(pastedByMiddle(5000, -Infinity)).toBe(false)
    expect(MIDDLE_PASTE_MS).toBe(1000)
  })
})

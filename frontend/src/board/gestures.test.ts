/** What the pointer and the wheel do on the board, and which pastes are the middle button's (Discussion #1). */

import { CLICK_PX, MIDDLE_PASTE_MS, emptyDrag, onlyLocked, pastedByMiddle, stayed, unlocked, wheelZoom } from './gestures'

describe('a drag on the empty board with the select tool', () => {
  it('draws a box with a mouse and a pen', () => {
    expect(emptyDrag('mouse')).toBe('marquee')
    expect(emptyDrag('pen')).toBe('marquee')
  })

  it('moves the board with a finger, which has no other way', () => {
    expect(emptyDrag('touch')).toBe('pan')
  })
})

describe('a press', () => {
  it('is a click while it stays near where it began', () => {
    expect(stayed({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true)
    expect(stayed({ x: 10, y: 10 }, { x: 10 + CLICK_PX - 1, y: 10 })).toBe(true)
  })

  it('is a drag from there on', () => {
    expect(stayed({ x: 10, y: 10 }, { x: 10 + CLICK_PX, y: 10 })).toBe(false)
    expect(stayed({ x: 10, y: 10 }, { x: 10, y: 10 - CLICK_PX })).toBe(false)
    expect(CLICK_PX).toBe(4)
  })
})

describe('the wheel with Ctrl', () => {
  it('takes ten percent per notch, whatever a mouse reports for it', () => {
    for (const notch of [33, 53, 100, 120, 1000]) {
      expect(wheelZoom(-notch)).toBeCloseTo(1.1)
      expect(wheelZoom(notch)).toBeCloseTo(1 / 1.1)
    }
  })

  it('follows the small steps of a pinch', () => {
    expect(wheelZoom(-2)).toBeCloseTo(Math.exp(0.02))
    expect(wheelZoom(5)).toBeCloseTo(Math.exp(-0.05))
    expect(wheelZoom(0)).toBe(1)
  })
})

describe('what is locked', () => {
  const items = [{ id: 'page', locked: true }, { id: 'ink' }, { id: 'open', locked: false }]

  it('is left out, and a line stays in', () => {
    expect(unlocked(['page', 'ink', 'line', 'open'], items)).toEqual(['ink', 'line', 'open'])
  })

  it('gives a drag nothing to hold only when nothing else is there', () => {
    expect(onlyLocked(['page'], items)).toBe(true)
    expect(onlyLocked(['page', 'ink'], items)).toBe(false)
    expect(onlyLocked(['page', 'line'], items)).toBe(false)
    expect(onlyLocked([], items)).toBe(false)
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

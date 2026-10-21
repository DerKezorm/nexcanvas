/** The words and buttons on a cover: the same on screen whatever the zoom, never larger than the frame holds. */

import { coverSize } from './HiddenCover'

describe('the cover of a hidden frame', () => {
  it('keeps its words at the same size on screen while the frame has room for them', () => {
    const frame = { w: 800, h: 500 }
    expect(coverSize(frame, 1)).toEqual({ board: 13, layout: 'full' })
    expect(coverSize(frame, 0.5).board * 0.5).toBeCloseTo(13)
    expect(coverSize(frame, 2).board).toBeCloseTo(6.5)
  })

  it('shows only the buttons on a low strip, such as one over the answers of a worksheet', () => {
    const strip = { w: 340, h: 60 }
    expect(coverSize(strip, 1)).toEqual({ board: 13, layout: 'row' })
  })

  it('shrinks with the frame when zoomed out, and keeps only the eye when the buttons get too small', () => {
    const frame = { w: 240, h: 160 }
    const far = coverSize(frame, 0.2)
    expect(far.board).toBeLessThanOrEqual(frame.w / 24)
    expect(far.board).toBeLessThanOrEqual(frame.h / 2.6)
    expect(far.layout).toBe('eye')
    expect(coverSize(frame, 1).layout).toBe('full')
  })
})

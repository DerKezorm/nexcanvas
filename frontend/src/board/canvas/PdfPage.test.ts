import { drawScale, MAX_PIXELS, sharpness } from './PdfPage'

const a4 = { width: 595, height: 842 }

describe('how sharp a PDF page is drawn', () => {
  it('follows the zoom in half steps, never below its size on the board', () => {
    expect(sharpness(0.5)).toBe(1)
    expect(sharpness(1)).toBe(1)
    expect(sharpness(1.1)).toBeCloseTo(Math.SQRT2)
    expect(sharpness(2)).toBe(2)
    expect(sharpness(3)).toBe(4)
  })

  it('draws a page wide on the screen as it is shown there, with the screen pixels', () => {
    expect(drawScale(a4, 595, 1, 1)).toBeCloseTo(1)
    expect(drawScale(a4, 595, 2, 2)).toBeCloseTo(4)
  })

  it('never takes more than its pixels, however far the board is zoomed in', () => {
    const scale = drawScale(a4, 595, 16, 2)
    expect(a4.width * scale * a4.height * scale).toBeLessThanOrEqual(MAX_PIXELS + 1)
    expect(a4.width * scale).toBeGreaterThan(2800)
  })
})

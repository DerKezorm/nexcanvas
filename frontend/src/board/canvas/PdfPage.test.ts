import { drawScale, MAX_PIXELS, readOptions, sharpness } from './PdfPage'

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

describe('how pdf.js reads a PDF', () => {
  it('finds the character maps of Chinese, Japanese and Korean fonts, and the rest it needs, on this server', async () => {
    const options = readOptions(new Uint8Array(), '/')
    // Without them the words of such a font stay blank (Discussion #1, a Japanese PDF).
    expect(options).toMatchObject({ cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/' })
    expect(options).toMatchObject({ isEvalSupported: false, enableXfa: false })
    // The build serves them from pdf.js' own folders (vite.config.ts, pdfjsData): they must be there.
    const name = 'node:fs'
    const files = (await import(/* @vite-ignore */ name)) as { existsSync: (file: string) => boolean }
    for (const file of ['cmaps/UniJIS-UCS2-H.bcmap', 'cmaps/Adobe-Japan1-UCS2.bcmap', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'iccs/CGATS001Compat-v2-micro.icc']) {
      expect(files.existsSync('node_modules/pdfjs-dist/' + file), file).toBe(true)
    }
  })
})

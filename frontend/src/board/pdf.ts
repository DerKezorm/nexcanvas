/**
 * A PDF made of pictures, one per page. Small on purpose: JPEG goes into a PDF as it is (DCTDecode), so a few objects
 * and a cross-reference table are all it takes, and no library of half a megabyte has to come along.
 */

export interface PdfPage {
  /** A baseline JPEG. */
  jpeg: Uint8Array
  /** Its size in pixels. */
  width: number
  height: number
  /** The page size in points (1/72 inch). */
  w: number
  h: number
}

const MAX_POINTS = 14400

export function pdfOfPictures(pages: PdfPage[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (piece: string | Uint8Array) => {
    const bytes = typeof piece === 'string' ? encoder.encode(piece) : piece
    parts.push(bytes)
    length += bytes.length
  }
  const begin = (id: number) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }
  const num = (n: number) => (Math.round(n * 100) / 100).toString()

  push('%PDF-1.4\n%âãÏÓ\n')
  begin(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  begin(2)
  push(`<< /Type /Pages /Kids [${pages.map((_, n) => `${3 + n * 3} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`)
  pages.forEach((page, n) => {
    const shrink = Math.min(1, MAX_POINTS / Math.max(page.w, page.h))
    const w = page.w * shrink
    const h = page.h * shrink
    const id = 3 + n * 3
    begin(id)
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>\nendobj\n`)
    begin(id + 1)
    push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`)
    push(page.jpeg)
    push('\nendstream\nendobj\n')
    const content = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`
    begin(id + 2)
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  })
  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

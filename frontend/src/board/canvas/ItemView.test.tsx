/** A video on the board opens in the browser to play; other files keep the plain card with its download. */
import { renderToStaticMarkup } from 'react-dom/server'
import { ItemView } from './ItemView'
import type { FileItem } from '../types'

const file = (ext: string, name: string): FileItem => ({ id: 'item01', kind: 'file', x: 0, y: 0, w: 190, h: 230, media: 'media0001', name, ext, sizeLabel: '3.2 MB' })
const noop = () => {}
const html = (item: FileItem) => renderToStaticMarkup(<ItemView item={item} editing={false} onText={noop} onDone={noop} onMeasure={noop} />)

describe('a file card', () => {
  it('plays a video: a link to the file itself, opened in a new tab, next to the download', () => {
    for (const ext of ['mp4', 'mov']) {
      const out = html(file(ext, 'clip.' + ext))
      expect(out).toContain('href="/api/media/media0001" target="_blank"')
      expect(out).toContain('href="/api/media/media0001?download=1"')
    }
  })

  it('offers any other file only to download', () => {
    const out = html(file('zip', 'plans.zip'))
    expect(out).not.toContain('target="_blank"')
    expect(out).toContain('href="/api/media/media0001?download=1"')
  })
})

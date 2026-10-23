/** A video on the board opens in the browser to play; other files keep the plain card with its download. A frame
 * without fill shows only its edge, and the name beside a narrow symbol runs on instead of breaking a word. */
import { renderToStaticMarkup } from 'react-dom/server'
import { ItemView } from './ItemView'
import { LibraryContext, makeLookup } from '../library/registry'
import type { FileItem, FrameItem, ShapeItem } from '../types'

const file = (ext: string, name: string): FileItem => ({ id: 'item01', kind: 'file', x: 0, y: 0, w: 190, h: 230, media: 'media0001', name, ext, sizeLabel: '3.2 MB' })
const noop = () => {}
const html = (item: FileItem | FrameItem) => renderToStaticMarkup(<ItemView item={item} editing={false} onDone={noop} onMeasure={noop} />)

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

describe('a frame', () => {
  const frame: FrameItem = { id: 'frame1', kind: 'frame', x: 0, y: 0, w: 200, h: 100, title: 'Answers', color: '#ef4444' }

  it('is tinted with its colour, or shows only its edge without fill', () => {
    expect(html(frame)).toContain('fill="#ef4444" fill-opacity="0.06"')
    const clear = html({ ...frame, clear: true })
    expect(clear).toContain('fill="none" fill-opacity="0.06" stroke="#ef4444"')
    expect(clear).not.toContain('fill="#ef4444"')
  })
})

describe('the words beside a symbol of the library', () => {
  const library = { lookup: makeLookup([], {}), packages: [], reload: () => {} }
  const shown = (item: ShapeItem) =>
    renderToStaticMarkup(
      <LibraryContext.Provider value={library}>
        <ItemView item={item} editing={false} onDone={noop} onMeasure={noop} />
      </LibraryContext.Provider>,
    )

  it('run on to the right of a phone instead of breaking "Phone" in two', () => {
    const phone: ShapeItem = { id: 'phone1', kind: 'shape', x: 0, y: 0, w: 40, h: 72, shape: 'rect', lib: 'network/phone', fill: '#60a5fa', stroke: 'none', text: 'Phone' }
    const out = shown(phone)
    expect(out).toContain('width:max-content;min-width:46px;white-space:nowrap')
  })

  it('stay in their box inside a shape', () => {
    const task: ShapeItem = { id: 'task1', kind: 'shape', x: 0, y: 0, w: 180, h: 110, shape: 'rect', lib: 'project/task', fill: '#fde68a', stroke: 'none', text: 'Plan the trip' }
    const out = shown(task)
    expect(out).not.toContain('max-content')
    expect(out).toContain('width:162px')
  })
})

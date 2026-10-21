/** A large photo comes as the server's smaller copy until zooming in would show its pixels, then as the original. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { BoardZoom } from './PdfPage'
import { Photo, PREVIEW_SIDE, wantsOriginal } from './Photo'
import type { ImageItem } from '../types'

const photo: ImageItem = { id: 'photo1', kind: 'image', x: 0, y: 0, w: 800, h: 600, media: 'abcdefgh12', preview: true }

let root: Root
let box: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
})

afterEach(() => {
  act(() => root.unmount())
  box.remove()
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode
  vi.useRealTimers()
})

const show = (item: ImageItem, zoom: number) =>
  act(() =>
    root.render(
      <BoardZoom.Provider value={zoom}>
        <Photo item={item} />
      </BoardZoom.Provider>,
    ),
  )
/** jsdom decodes no pictures: `decode` answers as told. */
function decoding(answer: () => Promise<void>) {
  const decode = vi.fn(answer)
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: decode, configurable: true })
  return decode
}
const shown = () => box.querySelector('img')!.getAttribute('src')

describe('a photo on the board', () => {
  it('knows the size of the server’s smaller copy', async () => {
    // Node's own modules, without their types in the app's build (the tests run in Node, from the frontend folder).
    const name = 'node:fs'
    const files = (await import(/* @vite-ignore */ name)) as { readFileSync: (file: string, encoding: string) => string }
    const server = files.readFileSync('../backend/app/services/media_store.py', 'utf-8')
    expect(server).toMatch(new RegExp(`^PREVIEW_SIDE = ${PREVIEW_SIDE}$`, 'm'))
  })

  it('wants the original only once the copy would show its pixels', () => {
    expect(wantsOriginal(photo, 1, 1)).toBe(false)
    expect(wantsOriginal(photo, 2, 1)).toBe(false)
    expect(wantsOriginal(photo, 2.8, 1)).toBe(true)
    // A screen with twice the pixels needs it sooner.
    expect(wantsOriginal(photo, 1, 2)).toBe(false)
    expect(wantsOriginal(photo, 1.4, 2)).toBe(true)
    // Without a smaller copy the original is shown anyway.
    expect(wantsOriginal({ ...photo, preview: false }, 16, 2)).toBe(false)
  })

  it('shows the copy, and the original once zoomed in and loaded', async () => {
    vi.useFakeTimers()
    let decoded: () => void = () => undefined
    const decode = decoding(() => new Promise<void>((resolve) => (decoded = resolve)))
    show(photo, 1)
    expect(shown()).toBe('/api/media/abcdefgh12?preview=1')

    show(photo, 3)
    // Not while the zoom still moves.
    expect(decode).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(decode).toHaveBeenCalled()
    // Still the copy while the original loads: never blank.
    expect(shown()).toBe('/api/media/abcdefgh12?preview=1')
    await act(async () => decoded())
    expect(shown()).toBe('/api/media/abcdefgh12')

    // Zoomed out again, the loaded original stays.
    show(photo, 0.5)
    expect(shown()).toBe('/api/media/abcdefgh12')
  })

  it('stays the copy when zoomed out, however large the photo lies on the board', async () => {
    vi.useFakeTimers()
    const decode = decoding(async () => undefined)
    show({ ...photo, w: 4000, h: 3000 }, 0.2)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(decode).not.toHaveBeenCalled()
    expect(shown()).toBe('/api/media/abcdefgh12?preview=1')
  })

  it('shows a small photo as it is', () => {
    show({ ...photo, preview: undefined }, 1)
    expect(shown()).toBe('/api/media/abcdefgh12')
  })
})

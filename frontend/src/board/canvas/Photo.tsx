/**
 * A photo on the board. A large one comes as its smaller copy (the server makes it, `PREVIEW_SIDE` pixels on its longer
 * side) until the board is zoomed in so far that the copy would show its pixels; then the original loads, and takes the
 * copy's place only when it is there (no blank moment). Once loaded, it stays.
 */
import { useContext, useEffect, useState } from 'react'

import { useMediaUrl } from './media'
import { BoardZoom, useDrawnZoom } from './PdfPage'
import type { ImageItem } from '../types'

/** The longer side of the server's smaller copy (`media_store.PREVIEW_SIDE`). */
export const PREVIEW_SIDE = 1600

/** Whether the smaller copy is too small for the size the photo has on the screen: its longer side on the board, the
 * zoom, the screen's pixels. */
// eslint-disable-next-line react-refresh/only-export-components
export function wantsOriginal(item: Pick<ImageItem, 'w' | 'h' | 'preview'>, zoom: number, pixelRatio: number): boolean {
  if (!item.preview) return false
  return Math.max(item.w, item.h) * zoom * Math.max(1, pixelRatio) > PREVIEW_SIDE
}

export function Photo({ item }: { item: ImageItem }) {
  const mediaUrl = useMediaUrl()
  // Zoomed out, the board's own zoom (the steps never go below 1); zoomed in, the step it rested at.
  const zoom = Math.min(useContext(BoardZoom), useDrawnZoom())
  const original = mediaUrl(item.media)
  const wanted = wantsOriginal(item, zoom, window.devicePixelRatio || 1)
  const [loaded, setLoaded] = useState<string | null>(null)

  useEffect(() => {
    if (!wanted || loaded === original) return
    let cancelled = false
    const picture = new Image()
    picture.src = original
    picture.decode().then(
      () => !cancelled && setLoaded(original),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [wanted, original, loaded])

  const shown = !item.preview || loaded === original ? original : mediaUrl(item.media, { preview: true })
  return <img src={shown} alt={item.caption ?? ''} draggable={false} loading="lazy" className="h-full w-full object-cover" />
}

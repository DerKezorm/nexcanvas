import { getStroke } from 'perfect-freehand'

import type { InkItem } from './types'

/** perfect-freehand gives the outline of a stroke as points; this turns it into a smooth SVG path. */
export function outline(points: number[][], size: number, marker = false, last = true): string {
  const stroke = getStroke(points, {
    size,
    thinning: marker ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: points.every((p) => p[2] === undefined || p[2] === 0.5),
    last,
  })
  if (stroke.length < 2) return ''
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let d = `M${stroke[0][0].toFixed(1)} ${stroke[0][1].toFixed(1)}Q`
  for (let i = 0; i < stroke.length; i++) {
    const a = stroke[i]
    const b = stroke[(i + 1) % stroke.length]
    const m = mid(a, b)
    d += `${a[0].toFixed(1)} ${a[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)} `
  }
  return d + 'Z'
}

// Keyed by the points: moving or recolouring copies the item but keeps the same points array.
const cache = new WeakMap<number[][], { size: number; marker: boolean; d: string }>()

/** The path of a drawn item in its own coordinates (the box as it was when drawn). */
export function inkPath(item: InkItem): string {
  const hit = cache.get(item.points)
  if (hit && hit.size === item.size && hit.marker === !!item.marker) return hit.d
  const d = outline(item.points, item.size, item.marker)
  cache.set(item.points, { size: item.size, marker: !!item.marker, d })
  return d
}

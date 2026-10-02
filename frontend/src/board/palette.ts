import type { NoteColor } from './types'

/** Paper colors for notes. The text on them stays dark in both modes. */
export const NOTE_COLORS: Record<NoteColor, string> = {
  yellow: '#fde68a',
  orange: '#fed7aa',
  pink: '#fbcfe8',
  violet: '#ddd6fe',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  gray: '#e4e4e7',
}

/**
 * Colors for shapes, text, pen and lines. `auto` is the text color of the current mode: white on the dark
 * board, black on the light one, so a drawing stays visible when someone switches.
 */
export const PALETTE = ['auto', '#ff8a70', '#f87171', '#fbbf24', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#a1a1aa'] as const

export function paint(color: string): string {
  if (color === 'auto') return 'var(--color-mist-100)'
  if (color === 'none') return 'transparent'
  return color
}

/** Fill colors for shapes: the palette plus a softer variant of each, and none. */
export const FILLS = ['none', '#ff8a70', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#3f3f46', '#fde68a', '#bfdbfe'] as const

/** Text on a filled shape: dark on light fills, light on dark ones. */
export function textOn(fill: string): string {
  if (fill === 'none' || fill === 'auto') return 'var(--color-mist-100)'
  const n = parseInt(fill.slice(1), 16)
  const r = n >> 16
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1917' : '#fafafa'
}

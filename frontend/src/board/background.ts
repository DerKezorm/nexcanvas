/**
 * The look behind a board's items (block 3): a pattern and a colour, chosen per board and the same for everybody who
 * has it open. Without a choice of its own a board follows the account's default (dots or nothing).
 *
 * The pattern lives in board units: it moves and grows with panning and zooming, so it reads as paper, and snapping
 * follows it.
 */
import type { CSSProperties } from 'react'

import type { Background, Pattern, View } from './types'

export const PATTERNS: Pattern[] = ['none', 'dots', 'grid', 'lines', 'mm', 'iso']

/** Named colours: `auto` follows light and dark; the others stay the same in both. */
export const COLORS: Record<string, string> = {
  auto: '',
  paper: '#ffffff',
  cream: '#f6f0e1',
  chalk: '#1f3b30',
  blueprint: '#1e3a6b',
}

/** One step of the pattern, in board units. */
export const STEP = 24
/** Millimetre paper: a fine line every 8 units, a stronger one every 5 of those. */
const MM = 8

/** The background of a board: its own, or the account's default. */
export function effectiveBackground(own: Background | undefined, dots: boolean): Background {
  return own ?? { pattern: dots ? 'dots' : 'none', color: 'auto' }
}

/** The colour of the board itself; empty: the mode's own board colour. */
export function baseColor(color: string): string {
  return color in COLORS ? COLORS[color] : /^#[0-9a-f]{6}$/i.test(color) ? color : ''
}

/** Whether a fixed colour is light; null for `auto`, which follows the mode. */
export function isLight(color: string): boolean | null {
  const hex = baseColor(color)
  if (!hex) return null
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140
}

/** The colour of the pattern's dots and lines on that board. */
function inkOf(color: string, strong = false): string {
  const light = isLight(color)
  // The mode's own dot colour; on millimetre paper the strong line lies over a fine one and so reads darker.
  if (light === null) return 'var(--color-board-dot)'
  return light ? `rgb(20 20 30 / ${strong ? 0.22 : 0.12})` : `rgb(255 255 255 / ${strong ? 0.2 : 0.1})`
}

/** A sample's ink: as on the board, but plain enough to tell the patterns apart at a glance. */
function sampleInk(color: string): string {
  const light = isLight(color)
  if (light === null) return 'color-mix(in srgb, var(--color-mist-100) 38%, transparent)'
  return light ? 'rgb(20 20 30 / 0.4)' : 'rgb(255 255 255 / 0.4)'
}

/** The CSS for the board's surface at the current view. `clear`: drawn stronger, for a small sample of it. */
export function backgroundStyle(bg: Background, view: View, clear = false): CSSProperties {
  const base = baseColor(bg.color)
  const ink = clear ? sampleInk(bg.color) : inkOf(bg.color)
  const s = STEP * view.zoom
  const at = `${view.x}px ${view.y}px`
  const style: CSSProperties = { backgroundColor: base || 'var(--color-board)' }
  switch (bg.pattern) {
    case 'none':
      return { ...style, backgroundImage: 'none' }
    case 'dots':
      return { ...style, backgroundImage: `radial-gradient(${ink} 1.1px, transparent 1.3px)`, backgroundSize: `${s}px ${s}px`, backgroundPosition: at }
    case 'grid':
      return {
        ...style,
        backgroundImage: `linear-gradient(to right, ${ink} 1px, transparent 1px), linear-gradient(to bottom, ${ink} 1px, transparent 1px)`,
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: at,
      }
    case 'lines':
      return { ...style, backgroundImage: `linear-gradient(to bottom, ${ink} 1px, transparent 1px)`, backgroundSize: `100% ${s}px`, backgroundPosition: at }
    case 'mm': {
      const fine = MM * view.zoom
      const strong = clear ? ink : inkOf(bg.color, true)
      return {
        ...style,
        backgroundImage: [
          `linear-gradient(to right, ${strong} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${strong} 1px, transparent 1px)`,
          `linear-gradient(to right, ${ink} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${ink} 1px, transparent 1px)`,
        ].join(', '),
        backgroundSize: `${fine * 5}px ${fine * 5}px, ${fine * 5}px ${fine * 5}px, ${fine}px ${fine}px, ${fine}px ${fine}px`,
        backgroundPosition: [at, at, at, at].join(', '),
      }
    }
    case 'iso': {
      // Dots on a triangle grid: two layers of dots, the second moved half a step across and down.
      const w = s * Math.sqrt(3)
      const dot = `radial-gradient(${ink} 1.1px, transparent 1.3px)`
      return {
        ...style,
        backgroundImage: `${dot}, ${dot}`,
        backgroundSize: `${w}px ${s}px, ${w}px ${s}px`,
        backgroundPosition: `${view.x}px ${view.y}px, ${view.x + w / 2}px ${view.y + s / 2}px`,
      }
    }
  }
}

/**
 * For a fixed colour, the text colour that reads on it, given to the items as their `auto` colour: white ink would
 * vanish on white paper in the dark mode.
 */
export function inkVariables(bg: Background): CSSProperties {
  const light = isLight(bg.color)
  if (light === null) return {}
  return { ['--color-mist-100' as string]: light ? '#14141a' : '#f2f2f5', ['--color-board' as string]: baseColor(bg.color) } as CSSProperties
}

/** Where moving snaps to on this pattern, per axis, in board units; null where it does not. */
export function gridStep(pattern: Pattern): { x: number | null; y: number | null } {
  switch (pattern) {
    case 'dots':
    case 'grid':
      return { x: STEP, y: STEP }
    case 'lines':
      return { x: null, y: STEP }
    case 'mm':
      return { x: MM, y: MM }
    default:
      return { x: null, y: null }
  }
}

/** The pattern painted on a canvas, for a picture of the board: `origin` is where board 0,0 lands, `scale` pixels per
 * board unit. Colours as the page shows them (`base`, `ink`). */
export function paintPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, origin: { x: number; y: number }, scale: number, base: string, ink: string) {
  const { width, height } = ctx.canvas
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1, scale * 0.5)
  const from = (o: number, step: number) => (((o % step) + step) % step) - step
  const s = STEP * scale
  const lines = (step: number, across: boolean, down: boolean) => {
    ctx.beginPath()
    if (across) for (let x = from(origin.x, step); x < width; x += step) ctx.rect(Math.round(x), 0, ctx.lineWidth, height)
    if (down) for (let y = from(origin.y, step); y < height; y += step) ctx.rect(0, Math.round(y), width, ctx.lineWidth)
    ctx.fill()
  }
  const dots = (stepX: number, stepY: number, offX: number, offY: number) => {
    ctx.beginPath()
    for (let x = from(origin.x + offX, stepX); x < width + stepX; x += stepX) {
      for (let y = from(origin.y + offY, stepY); y < height + stepY; y += stepY) {
        ctx.moveTo(x + 1.2 * scale, y)
        ctx.arc(x, y, 1.2 * scale, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  }
  switch (pattern) {
    case 'dots':
      return dots(s, s, 0, 0)
    case 'grid':
      return lines(s, true, true)
    case 'lines':
      return lines(s, false, true)
    case 'mm':
      lines(MM * scale, true, true)
      return lines(MM * scale * 5, true, true)
    case 'iso': {
      const w = s * Math.sqrt(3)
      dots(w, s, 0, 0)
      return dots(w, s, w / 2, s / 2)
    }
  }
}

/** The colours a picture of the board paints its pattern in, as the page shows them on `surface` (the board). */
export function pictureColors(bg: Background, surface: Element): { base: string; ink: string } {
  const style = getComputedStyle(surface)
  const base = baseColor(bg.color) || style.backgroundColor
  const light = isLight(bg.color)
  const ink = light === null ? style.getPropertyValue('--color-board-dot').trim() || 'rgb(255 255 255 / 0.1)' : inkOf(bg.color)
  return { base, ink }
}

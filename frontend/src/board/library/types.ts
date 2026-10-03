/**
 * Shape packages (block 4): named collections of shapes, like Visio's stencils. Some come with nexcanvas (basic
 * shapes, flowchart, floor plan, project management, network), others are installed per space or for the whole server
 * and can be made from the board ("save as shape") or from SVG files.
 *
 * A shape is never markup: it is a short list of drawing elements with whitelisted fields (`ShapeElement`), drawn by
 * React element by element. A package from somewhere else can therefore never run anything, whatever it holds; the
 * server checks the same list again before it keeps a package.
 *
 * Colours are roles, not values: `fill` is the colour the item is filled with, `line` its line colour, `ink` the line
 * colour of details lying on the fill (dark on a light fill, light on a dark one, as the words), `soft` the line colour
 * faintly, `paper` the board under it. So a router turns green with the rest of the drawing when someone picks green,
 * and reads in light and dark.
 */

import type { ShapeKind } from '../types'

export type Paint = 'fill' | 'line' | 'ink' | 'soft' | 'paper' | 'none'

export type ShapeElement =
  | { t: 'path'; d: string; f?: Paint; s?: Paint; w?: number; dash?: boolean; tx?: number; ty?: number; sx?: number; sy?: number }
  | { t: 'rect'; x: number; y: number; width: number; height: number; rx?: number; f?: Paint; s?: Paint; w?: number; dash?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; f?: Paint; s?: Paint; w?: number; dash?: boolean }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; f?: Paint; s?: Paint; w?: number; dash?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; s?: Paint; w?: number; dash?: boolean }

/** A place inside the shape as parts of its width and height (0 to 1). */
export interface Part {
  x: number
  y: number
}

export interface ShapeDef {
  /** Unique within its package: lower case letters, digits and dashes. */
  id: string
  /** Shown names, at least English; the language of the page wins when there. */
  name: Record<string, string>
  /** Further words the search finds it by. */
  words?: string[]
  /** The drawing's own width and height; the elements are drawn in that box. */
  vw: number
  vh: number
  /** The size it gets when placed with a click; the drawing box when left out. In a floor plan one unit is a cm. */
  w?: number
  h?: number
  /** Keeps the proportions when resized (a chair stays a chair). */
  keep?: boolean
  elements: ShapeElement[]
  /** Where the words go, as parts of the box; nowhere when left out of a shape that has `quiet`. */
  text?: { x: number; y: number; w: number; h: number }
  /** No words by default (a wall, a plant); a double click can still add some. */
  quiet?: boolean
  /** The outline lines meet, as parts of the box; the box itself when left out. */
  outline?: Part[]
  /** The words show the width in centimetres while nobody has written any (a dimension line). */
  measure?: boolean
  /** The fill a new one gets; the drawing's line colour stays automatic. */
  fill?: string
  /** A container (a room, a lane, a zone): only its lines answer the pointer, so what lies in it stays reachable. */
  hollow?: boolean
  /** The words a new one starts with (the number on a marker). */
  word?: string
  /** One of the board's own shapes (the toolbar's): placed as that, not as a shape of a package. Shipped only. */
  native?: ShapeKind
}

export interface ShapePackage {
  /** Lower case letters, digits and dashes; for the shipped packages fixed, for others made when installed. */
  id: string
  name: Record<string, string>
  version: string
  author: string
  license: string
  /** Shapes come with nexcanvas, cannot be removed or changed. */
  builtin?: boolean
  /** Who the package belongs to: the server, a space (by id), or nexcanvas itself. */
  scope?: 'builtin' | 'server' | 'space'
  space?: number | null
  /** The server's number for it, for changing and removing. */
  key?: number
  enabled?: boolean
  shapes: ShapeDef[]
}

/** The name of a package or a shape in the page's language, else English, else the first one there is. */
export function named(names: Record<string, string>, language: string): string {
  const short = language.split('-')[0]
  return names[language] ?? names[short] ?? names.en ?? Object.values(names)[0] ?? '?'
}

/** The key a shape is known by on a board: package and shape id. */
export function shapeKey(pkg: string, shape: string): string {
  return `${pkg}/${shape}`
}

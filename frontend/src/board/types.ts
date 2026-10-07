/**
 * What lies on a board. Everything is in board coordinates: one unit is one pixel at 100 % zoom,
 * the origin is arbitrary, the board has no edge.
 *
 * The order of `items` is the stacking order: the last one lies on top.
 */

import type { ShapeDef } from './library/types'

export type NoteColor = 'yellow' | 'orange' | 'pink' | 'violet' | 'blue' | 'green' | 'gray'

export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'arrow' | 'speech'

export type TextSize = 's' | 'm' | 'l' | 'xl'

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Stacking order: higher lies on top. */
  z?: number
  /** Turned around its middle, in degrees. */
  rot?: number
  /** Items with the same group move and get selected together. */
  group?: string
  locked?: boolean
}

export interface NoteItem extends Box {
  kind: 'note'
  text: string
  color: NoteColor
}

export interface ShapeItem extends Box {
  kind: 'shape'
  shape: ShapeKind
  /** A shape of a package (`package/shape`); `shape` is then what an older page draws instead. */
  lib?: string
  /** A color from the palette, or `none`. */
  fill: string
  stroke: string
  text: string
}

export interface TextItem extends Box {
  kind: 'text'
  text: string
  size: TextSize
  color: string
  hand?: boolean
}

export interface InkItem extends Box {
  kind: 'ink'
  /** Points relative to the box as it was when drawn: x, y, pressure. */
  points: number[][]
  /** The box size when drawn. Resizing stretches the drawing from there. */
  ow: number
  oh: number
  color: string
  size: number
  marker?: boolean
  /** Drawn on a page of a PDF: shown while that page is, and moved with the PDF. */
  on?: { item: string; page: number }
}

export interface ImageItem extends Box {
  kind: 'image'
  /** The id of the photo on the server (``/api/media/<id>``). Never an address: the page builds that itself. */
  media: string
  /** A smaller copy exists for showing on the board. */
  preview?: boolean
  caption?: string
}

export interface FileItem extends Box {
  kind: 'file'
  media: string
  name: string
  ext: string
  sizeLabel: string
  pages?: number
  /** The page a PDF shows on the board, from 1. */
  page?: number
}

/** A named area of the board (Freeform: a scene); moving it moves what lies on it. */
export interface FrameItem extends Box {
  kind: 'frame'
  title: string
  color: string
}

export interface LinkItem extends Box {
  kind: 'link'
  url: string
  title: string
  site: string
  hue: number
}

export type Item = NoteItem | ShapeItem | TextItem | InkItem | ImageItem | FileItem | LinkItem | FrameItem

/** One end of a line: fixed to an item (then it sits on its edge) or free on the board. */
export interface End {
  item?: string
  x: number
  y: number
}

export interface LineItem {
  id: string
  kind: 'line'
  a: End
  b: End
  color: string
  width: number
  arrow: 'none' | 'end' | 'both'
  curve: boolean
  dashed?: boolean
}

/** The pattern behind a board's items. */
export type Pattern = 'none' | 'dots' | 'grid' | 'lines' | 'mm' | 'iso'

/** A board's own background: a pattern and a named colour (`auto`, `paper` …) or one written as #rrggbb. */
export interface Background {
  pattern: Pattern
  color: string
}

export interface Doc {
  items: Item[]
  lines: LineItem[]
  /** Kept apart in the live document (`useLiveDoc`); here for pictures, templates and copies. */
  background?: Background
  /** The shapes of packages the board uses, so everybody sees them without having the package. */
  defs?: Record<string, ShapeDef>
}

export interface View {
  x: number
  y: number
  zoom: number
}

export type Role = 'read' | 'write' | 'manage'

/** A board as the overview knows it: its place, its state, and a picture of what is on it. */
export interface Board extends Doc {
  id: string
  title: string
  created: number
  updated: number
  updatedBy: string
  opened: number
  favorite: boolean
  space: number
  publicLink: boolean
  deleted?: number
  role: Role | null
}

export interface Person {
  id: number
  name: string
  display_name: string
  avatar: string | null
}

/** The longest name a board may have, as the server allows it (services/boards.py MAX_TITLE). */
export const TITLE_MAX = 200

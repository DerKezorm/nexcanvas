/**
 * What lies on a board. Everything is in board coordinates: one unit is one pixel at 100 % zoom,
 * the origin is arbitrary, the board has no edge.
 *
 * The order of `items` is the stacking order: the last one lies on top.
 */

export type NoteColor = 'yellow' | 'orange' | 'pink' | 'violet' | 'blue' | 'green' | 'gray'

export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'arrow' | 'speech'

export type TextSize = 's' | 'm' | 'l' | 'xl'

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
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
}

export interface ImageItem extends Box {
  kind: 'image'
  src: string
  caption?: string
}

export interface FileItem extends Box {
  kind: 'file'
  name: string
  ext: string
  sizeLabel: string
  pages?: number
}

export interface LinkItem extends Box {
  kind: 'link'
  url: string
  title: string
  site: string
  hue: number
}

export type Item = NoteItem | ShapeItem | TextItem | InkItem | ImageItem | FileItem | LinkItem

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

export interface Doc {
  items: Item[]
  lines: LineItem[]
}

export interface View {
  x: number
  y: number
  zoom: number
}

export interface Board extends Doc {
  id: string
  title: string
  created: number
  updated: number
  opened: number
  favorite: boolean
  /** The space it lives in. Who may open it follows from the members of the space, as in nexlore. */
  space: string
  /** A public read-only page, as nexlore's shares. */
  publicLink: boolean
  deleted?: number
  view?: View
}

export interface Person {
  id: string
  name: string
  email: string
  color: string
}

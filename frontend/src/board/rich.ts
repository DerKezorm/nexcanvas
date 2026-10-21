/**
 * The formatting inside an item's words: bold, italic, underlined, struck through, a colour and a size for a part, a
 * bullet or numbered list for a line. It lives in the item's shared Yjs text as Quill writes it (`Y.Text` attributes),
 * so two people still type in the same note together; the plain words stay what they were (`item.text`).
 *
 * A picture of the board carries it as `rich` (a Quill delta), and only where there is any. Lines follow Quill: every
 * line ends with a newline, the last one may leave it out, so "a" and "a\n" are one line each.
 */

/** What a part of the words may carry, and what a line may. */
export interface Marks {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  color?: string
  size?: TextSizeMark
}
/** A size for a part: pixels as `24px`, or one of the three steps of 0.6 (`SIZE_MARKS`), still shown as they were. */
export type TextSizeMark = 'small' | 'large' | 'huge' | `${number}px`
export type ListKind = 'bullet' | 'ordered'
export type SpanLook = 'bold' | 'italic' | 'underline' | 'strike'

export interface Run {
  insert: string
  attributes?: Marks & { list?: ListKind }
}

export const SPAN_LOOKS: SpanLook[] = ['bold', 'italic', 'underline', 'strike']
export const SIZE_MARKS = ['small', 'large', 'huge'] as const
/** How much larger or smaller a part of one of the old steps is than the item's own words. */
export const SIZE_EM: Record<(typeof SIZE_MARKS)[number], number> = { small: 0.75, large: 1.5, huge: 2 }
/** The sizes offered, in pixels on the board, for parts and for whole items alike; any whole number in between goes. */
export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 56, 72, 96]
export const FONT_MIN = 6
export const FONT_MAX = 200
const PX = /^(\d{1,3})px$/

/** The pixels of a size in the words (`24px`), or null for none or one of the old steps. */
export function pxOf(size: unknown): number | null {
  const match = typeof size === 'string' ? PX.exec(size) : null
  const n = match ? Number(match[1]) : NaN
  return n >= FONT_MIN && n <= FONT_MAX ? n : null
}

/** A number typed or picked as a size: whole, and within what the board allows. */
export function fontSize(n: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)))
}

/** Whether a size may stand in the words: pixels within bounds, or one of the old steps. */
export function isSize(size: unknown): size is TextSizeMark {
  return pxOf(size) !== null || (SIZE_MARKS as readonly unknown[]).includes(size)
}
const HEX = /^#[0-9a-f]{6}$/i

/** The formats the editor knows; nothing else ever reaches the words, pasted or not. */
export const EDITOR_FORMATS = ['bold', 'italic', 'underline', 'strike', 'color', 'size', 'list']

/** Only what the board knows, with values it knows: everything else is dropped, never shown. */
export function cleanRuns(value: unknown): Run[] {
  if (!Array.isArray(value)) return []
  const out: Run[] = []
  for (const op of value) {
    if (!op || typeof op !== 'object' || typeof (op as Run).insert !== 'string' || !(op as Run).insert) continue
    const raw = (op as { attributes?: unknown }).attributes
    const attributes: Run['attributes'] = {}
    if (raw && typeof raw === 'object') {
      const given = raw as Record<string, unknown>
      for (const look of SPAN_LOOKS) if (given[look] === true) attributes[look] = true
      if (typeof given.color === 'string' && HEX.test(given.color)) attributes.color = given.color.toLowerCase()
      if (isSize(given.size)) attributes.size = given.size
      if (given.list === 'bullet' || given.list === 'ordered') attributes.list = given.list
    }
    const run: Run = { insert: (op as Run).insert }
    if (Object.keys(attributes).length) run.attributes = attributes
    const last = out[out.length - 1]
    if (last && sameAttributes(last.attributes, run.attributes)) last.insert += run.insert
    else out.push(run)
  }
  return out
}

function sameAttributes(a?: Run['attributes'], b?: Run['attributes']): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

export function hasMarks(runs: Run[]): boolean {
  return runs.some((run) => run.attributes && Object.keys(run.attributes).length > 0)
}

export function plainOf(runs: Run[]): string {
  return runs.map((run) => run.insert).join('')
}

export interface Line {
  list?: ListKind
  parts: Run[]
}

/** The words as lines, as Quill shows them: a newline ends a line and carries its list; the last may have none. */
export function linesOf(runs: Run[]): Line[] {
  const lines: Line[] = []
  let parts: Run[] = []
  for (const run of runs) {
    const pieces = run.insert.split('\n')
    pieces.forEach((piece, n) => {
      if (piece) parts.push(run.attributes ? { insert: piece, attributes: inline(run.attributes) } : { insert: piece })
      if (n < pieces.length - 1) {
        lines.push(run.attributes?.list ? { list: run.attributes.list, parts } : { parts })
        parts = []
      }
    })
  }
  const last = runs[runs.length - 1]
  if (parts.length || !last || !last.insert.endsWith('\n')) lines.push({ parts })
  return lines
}

/** The marks of a part without the line's own. */
function inline(attributes: NonNullable<Run['attributes']>): Marks | undefined {
  const { list: _list, ...rest } = attributes
  return Object.keys(rest).length ? rest : undefined
}

/** Every letter carries the look (newlines and spaces between words aside), and there is at least one. */
export function allHave(runs: Run[] | undefined, look: SpanLook): boolean {
  if (!runs?.length) return false
  let seen = false
  for (const run of runs) {
    if (!run.insert.replace(/\s/g, '')) continue
    if (!run.attributes?.[look]) return false
    seen = true
  }
  return seen
}

/** The runs of plain words: one, or none when there are no words. */
export function runsOf(text: string, rich: Run[] | undefined): Run[] {
  if (rich?.length) return rich
  return text ? [{ insert: text }] : []
}

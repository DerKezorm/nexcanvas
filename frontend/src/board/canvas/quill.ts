/**
 * The editor for the words of notes, shapes and texts: Quill, with only the formats the board knows (`EDITOR_FORMATS`),
 * bound to the item's shared Yjs text.
 *
 * Only Quill's core and these formats are loaded. Formula and video, the embeds of CVE-2025-15056, are never
 * registered, and the board never asks Quill for HTML: it draws the words itself (`Words`).
 */

import Quill, { Delta, type Op } from 'quill/core'
import Bold from 'quill/formats/bold'
import { ColorStyle } from 'quill/formats/color'
import Italic from 'quill/formats/italic'
import List from 'quill/formats/list'
import Strike from 'quill/formats/strike'
import Underline from 'quill/formats/underline'
import { Scope, StyleAttributor } from 'parchment'
import type * as Y from 'yjs'

import { cleanRuns, isSize, pxOf, SIZE_EM, type Run, type SpanLook } from '../rich'
import { baseOf, type Worded } from '../textLook'
import type { TextLook } from '../types'

/**
 * The size of a part: pixels (`24px`) as they are, the old steps of 0.6 (`small`, `large`, `huge`) as the share of the
 * item's own size they always were. The value itself rides along on the element, so a part keeps the size it had.
 */
class SizeStyle extends StyleAttributor {
  add(node: HTMLElement, value: unknown): boolean {
    if (!isSize(value)) return false
    node.style.fontSize = pxOf(value) !== null ? value : `${SIZE_EM[value as keyof typeof SIZE_EM]}em`
    node.dataset.size = value
    return true
  }

  remove(node: HTMLElement): void {
    super.remove(node)
    delete node.dataset.size
  }

  value(node: HTMLElement): string {
    const size = node.dataset.size
    return isSize(size) ? size : ''
  }
}

const Size = new SizeStyle('size', 'font-size', { scope: Scope.INLINE })

Quill.register(
  {
    'formats/bold': Bold,
    'formats/italic': Italic,
    'formats/underline': Underline,
    'formats/strike': Strike,
    'formats/color': ColorStyle,
    'formats/size': Size,
    'formats/list': List,
  },
  true,
)

export { Quill }

/** The shared words as an editor gets them from the board (`useLiveDoc().words`). */
export interface SharedWords {
  text: Y.Text
  transact: (change: () => void) => void
  mine: (transaction: Y.Transaction) => boolean
}

function asDelta(runs: Run[]): Delta {
  return new Delta(runs as Op[])
}

/** The length Quill has for the words: one more than the text when its last line has no newline of its own. */
export function editorLength(text: string): number {
  return text.length + (text.endsWith('\n') ? 0 : 1)
}

/**
 * Keeps the editor and the shared words the same: what is typed goes into the words as this tab's change, what
 * arrives from someone else (or from undo) goes into the editor at once, the caret moving along. Returns the unbinding.
 */
export function bindWords(quill: Quill, words: SharedWords): () => void {
  const { text } = words
  quill.setContents(asDelta(cleanRuns(text.toDelta())), 'silent')
  const typed = (change: Delta, _old: Delta, source: string) => {
    if (source === 'silent') return
    words.transact(() => text.applyDelta(change.ops))
  }
  const arrived = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (words.mine(transaction)) return
    // Only words come in as they are; anything else (an embed someone put in by hand) makes the editor start again.
    const plain = event.delta.every((op) => op.insert === undefined || typeof op.insert === 'string')
    if (plain) quill.updateContents(new Delta(event.delta as Op[]), 'silent')
    // A newline that only Quill had at the end, now also in the words, is one line too many: start again from them.
    if (!plain || quill.getLength() !== editorLength(text.toString())) {
      const range = quill.getSelection()
      quill.setContents(asDelta(cleanRuns(text.toDelta())), 'silent')
      if (range) quill.setSelection(Math.min(range.index, quill.getLength() - 1), range.length, 'silent')
    }
  }
  quill.on('text-change', typed)
  text.observe(arrived)
  return () => {
    quill.off('text-change', typed)
    text.unobserve(arrived)
  }
}

/**
 * Switches a look for what is marked in the editor, or for what is typed next when nothing is. When the item itself
 * has the look (all its words, or a large text that is bold by itself), the look first moves into the words, so a
 * part of them can go without it.
 */
export function toggleLook(quill: Quill, item: Worded, look: SpanLook, setBase: (change: Partial<TextLook>) => void): void {
  const range = quill.getSelection(true)
  const end = quill.getLength() - 1
  let on = quill.getFormat(range)[look] === true
  if (baseOf(item, look)) {
    setBase({ [look]: false })
    if (end > 0) quill.formatText(0, end, look, true, 'user')
    on = true
  }
  if (range.length) quill.formatText(range.index, range.length, look, !on, 'user')
  else quill.format(look, !on, 'user')
}

/** Pasted words keep bold, italic, underlined, struck through and lists; colours and sizes from elsewhere stay out. */
export function plainerPaste(quill: Quill): void {
  quill.clipboard.addMatcher(Node.ELEMENT_NODE, (_node, delta) => {
    for (const op of delta.ops) {
      if (op.attributes) {
        delete op.attributes.color
        delete op.attributes.size
        delete op.attributes.background
      }
    }
    return delta
  })
}

/** The editor and the shared words: what one types, the other sees; formatting goes along; nothing strange gets in. */

import * as Y from 'yjs'

import type { Worded } from '../textLook'
import { bindWords, editorLength, plainerPaste, Quill, toggleLook, type SharedWords } from './quill'
import { EDITOR_FORMATS } from '../rich'

const LOCAL = Symbol('local')

// jsdom measures no ranges; Quill asks for them when it brings the caret into view.
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
})

/** One tab: a document (a new one, or one that already has the note), its shared words, an editor bound to them. */
function tab(doc = new Y.Doc(), name = 'note0001') {
  const texts = doc.getMap<Y.Text>('texts')
  if (!texts.has(name)) texts.set(name, new Y.Text())
  const text = texts.get(name)!
  const words: SharedWords = {
    text,
    transact: (change) => doc.transact(change, LOCAL),
    mine: (transaction) => transaction.origin === LOCAL,
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const quill = new Quill(host, { formats: EDITOR_FORMATS })
  return { doc, text, words, quill, bind: () => bindWords(quill, words) }
}

/** Two tabs on the same board: every change of one reaches the other at once, as over the live connection. */
function pair() {
  const a = tab()
  // The second tab gets the board from the first, note and all, as a browser gets it from the server.
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(a.doc))
  const b = tab(other)
  const fresh = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'wire') Y.applyUpdate(to, update, 'wire')
  }
  a.doc.on('update', fresh(b.doc))
  b.doc.on('update', fresh(a.doc))
  return { a, b }
}

const plain = (quill: Quill) => quill.getText()

describe('the editor and the shared words', () => {
  it('gives a part a size in pixels and keeps an old step as it was, both ways', () => {
    const one = tab()
    one.text.applyDelta([{ insert: 'alt', attributes: { size: 'large' } }, { insert: ' neu' }])
    one.bind()
    expect(one.quill.root.querySelector('span')?.style.fontSize).toBe('1.5em')
    one.quill.formatText(4, 3, 'size', '24px', 'user')
    expect(one.text.toDelta()).toEqual([{ insert: 'alt', attributes: { size: 'large' } }, { insert: ' ' }, { insert: 'neu', attributes: { size: '24px' } }])
    expect(one.quill.getFormat(4, 3).size).toBe('24px')
    one.quill.formatText(4, 3, 'size', '9999px', 'user')
    expect(one.quill.getFormat(4, 3).size).toBe('24px')
  })

  it('starts with the words and their formatting', () => {
    const one = tab()
    one.text.applyDelta([{ insert: 'Hallo ' }, { insert: 'Welt', attributes: { bold: true } }])
    one.bind()
    expect(one.quill.getContents().ops).toEqual([{ insert: 'Hallo ' }, { insert: 'Welt', attributes: { bold: true } }, { insert: '\n' }])
  })

  it('hands what is typed to the words as this tab’s change, formatting and all', () => {
    const one = tab()
    one.bind()
    const origins: unknown[] = []
    one.doc.on('afterTransaction', (t: Y.Transaction) => origins.push(t.origin))
    one.quill.insertText(0, 'Milch', 'user')
    one.quill.formatText(0, 2, 'italic', true, 'user')
    expect(one.text.toDelta()).toEqual([{ insert: 'Mi', attributes: { italic: true } }, { insert: 'lch' }])
    expect(origins.every((o) => o === LOCAL)).toBe(true)
  })

  it('shows what someone else types the moment it arrives, the caret moving along', () => {
    const { a, b } = pair()
    a.bind()
    b.bind()
    a.quill.insertText(0, 'Brot', 'user')
    expect(plain(b.quill)).toBe('Brot\n')
    b.quill.setSelection(4, 0)
    a.quill.insertText(0, 'Hafer', 'user')
    expect(plain(b.quill)).toBe('HaferBrot\n')
    expect(b.quill.getSelection()?.index).toBe(9)
    a.quill.formatText(0, 5, 'bold', true, 'user')
    expect(b.quill.getContents().ops[0]).toEqual({ insert: 'Hafer', attributes: { bold: true } })
  })

  it('stays the same length as the words when the last line becomes a list elsewhere', () => {
    const { a, b } = pair()
    a.bind()
    b.bind()
    a.quill.insertText(0, 'eins', 'user')
    // The words had no newline at the end; making the last line a list gives them one.
    a.quill.formatLine(0, 1, 'list', 'bullet', 'user')
    expect(a.text.toString()).toBe('eins\n')
    expect(b.quill.getLength()).toBe(editorLength(b.text.toString()))
    expect(b.quill.getContents().ops).toEqual([{ insert: 'eins' }, { insert: '\n', attributes: { list: 'bullet' } }])
  })

  it('takes back with the board’s undo, and the editor follows', () => {
    const one = tab()
    one.bind()
    const undo = new Y.UndoManager(one.doc.getMap('texts'), { trackedOrigins: new Set([LOCAL]) })
    one.quill.insertText(0, 'weg', 'user')
    undo.stopCapturing()
    one.quill.formatText(0, 3, 'strike', true, 'user')
    undo.undo()
    expect(one.quill.getContents().ops).toEqual([{ insert: 'weg\n' }])
    undo.undo()
    expect(plain(one.quill)).toBe('\n')
  })

  it('lets go when unbound', () => {
    const { a, b } = pair()
    a.bind()
    const unbind = b.bind()
    unbind()
    a.quill.insertText(0, 'später', 'user')
    expect(plain(b.quill)).toBe('\n')
  })
})

describe('switching a look while writing', () => {
  const note = (more: Partial<Worded> = {}): Worded => ({ id: 'note0001', kind: 'note', x: 0, y: 0, w: 100, h: 100, color: 'yellow', text: 'ab cd', ...more }) as Worded

  it('sets it for what is marked only', () => {
    const one = tab()
    one.text.insert(0, 'ab cd')
    one.bind()
    one.quill.setSelection(3, 2)
    const base = vi.fn()
    toggleLook(one.quill, note(), 'bold', base)
    expect(one.text.toDelta()).toEqual([{ insert: 'ab ' }, { insert: 'cd', attributes: { bold: true } }])
    expect(base).not.toHaveBeenCalled()
    toggleLook(one.quill, note(), 'bold', base)
    expect(one.text.toDelta()).toEqual([{ insert: 'ab cd' }])
  })

  it('moves the item’s own look into the words, so a part can go without it', () => {
    const one = tab()
    one.text.insert(0, 'ab cd')
    one.bind()
    one.quill.setSelection(3, 2)
    const base = vi.fn()
    // A large text is bold by itself: taking bold from "cd" leaves "ab " bold.
    toggleLook(one.quill, note({ kind: 'text', size: 'xl', color: 'auto' } as Partial<Worded>), 'bold', base)
    expect(base).toHaveBeenCalledWith({ bold: false })
    expect(one.text.toDelta()).toEqual([{ insert: 'ab ', attributes: { bold: true } }, { insert: 'cd' }])
  })
})

describe('pasting', () => {
  it('keeps bold, italic and lists, drops colours and sizes from elsewhere', () => {
    const one = tab()
    plainerPaste(one.quill)
    const delta = one.quill.clipboard.convert({ html: '<p><b>fett</b> <span style="color: rgb(255, 0, 0); font-size: 40px">rot</span></p><ul><li>eins</li></ul><p><a href="javascript:alert(1)">Verweis</a></p>' })
    expect(JSON.stringify(delta.ops)).not.toMatch(/color|size|link|javascript/)
    expect(delta.ops).toContainEqual({ insert: 'fett', attributes: { bold: true } })
    expect(delta.ops.some((op) => op.attributes?.list === 'bullet' && String(op.insert).includes('eins'))).toBe(true)
  })
})

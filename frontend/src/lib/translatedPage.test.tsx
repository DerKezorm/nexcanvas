/** A page the browser translated keeps working: React must not bring it down over nodes that are gone. */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'

import { bearTranslatedPages } from './translatedPage'

/** What Chrome's translator does: each text node is replaced by <font><font>…</font></font>. */
function translateLikeChrome(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const text of texts) {
    const outer = document.createElement('font')
    const inner = document.createElement('font')
    inner.textContent = text.data
    outer.appendChild(inner)
    text.replaceWith(outer)
  }
}

function Line({ busy, note }: { busy: boolean; note: boolean }) {
  return (
    <p data-testid="line">
      {busy && <b>busy</b>}
      Saved
      {note && ' just now'}
    </p>
  )
}

let root: Root | null = null
let host: HTMLElement

function show(busy: boolean, note: boolean) {
  act(() => {
    if (!root) {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
    }
    root.render(<Line busy={busy} note={note} />)
  })
  return host.querySelector('[data-testid="line"]')!
}

beforeAll(() => {
  bearTranslatedPages()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

test('a translated page keeps working when something appears before a text', () => {
  translateLikeChrome(show(false, false))

  // Where the text belonged nobody knows any more; what is new then stands at the end rather than nowhere.
  expect(show(true, false).querySelector('b')).not.toBeNull()
})

test('something meant to go before a wrapped node goes before its wrapper', () => {
  show(false, false)
  const paragraph = document.createElement('p')
  const text = document.createTextNode('Saved')
  paragraph.append(document.createTextNode('a'), text)
  const wrapper = document.createElement('font')
  paragraph.replaceChild(wrapper, text)
  wrapper.appendChild(text)

  paragraph.insertBefore(document.createElement('b'), text)

  expect([...paragraph.childNodes].map((node) => node.nodeName)).toEqual(['#text', 'B', 'FONT'])
})

test('a translated page keeps working when a text goes away', () => {
  translateLikeChrome(show(false, true))

  expect(show(false, false).isConnected).toBe(true)
})

test('an untouched page still puts things where React wants them', () => {
  show(false, false)
  expect(show(true, true).textContent).toBe('busySaved just now')
  expect(show(false, false).textContent).toBe('Saved')
})

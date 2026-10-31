/** Focus in a dialog belongs to its opening, not to every new `onClose` a caller passes while somebody types. */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { Dialog } from './Dialog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

/** Holds the words itself and passes a new `onClose` with each render, as the sign-in provider's dialog does. */
function Form({ onClose }: { onClose: (words: string) => void }) {
  const [issuer, setIssuer] = useState('')
  return (
    <Dialog title="Add provider" onClose={() => onClose(issuer)}>
      <input aria-label="name" />
      <input aria-label="issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
    </Dialog>
  )
}

function open(onClose: (words: string) => void) {
  const host = document.createElement('div')
  document.body.append(host)
  let root!: Root
  act(() => {
    root = createRoot(host)
    root.render(<Form onClose={onClose} />)
  })
  const field = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!
  return { field, close: () => act(() => root.unmount()) }
}

/** Types as React sees it: the value through the native setter, then the input event. */
function type(field: HTMLInputElement, words: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(field, words)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('a dialog with several fields', () => {
  it('starts in the first field', () => {
    const { field, close } = open(() => {})
    expect(document.activeElement).toBe(field('name'))
    close()
  })

  it('leaves the cursor in a later field while somebody types there', () => {
    const { field, close } = open(() => {})
    act(() => field('issuer').focus())

    type(field('issuer'), 'h')
    type(field('issuer'), 'ht')

    expect(document.activeElement).toBe(field('issuer'))
    expect(field('issuer').value).toBe('ht')
    close()
  })

  it('closes with Escape through the newest function, which knows the words', () => {
    const onClose = vi.fn()
    const { field, close } = open(onClose)
    type(field('issuer'), 'h')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('h')
    close()
  })

  it('gives the focus back to what had it before', () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()

    const { close } = open(() => {})
    expect(document.activeElement).not.toBe(before)
    close()

    expect(document.activeElement).toBe(before)
    before.remove()
  })
})

// The tools on the left of the board, and a frame without fill (Discussion #1, 0.8.0): selecting also moves the board,
// so the hand has no button of its own and shows only while H holds it; the shapes taken last are in the shape panel.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import i18n from '../../i18n'
import { BUILTIN } from '../library/builtin'
import type { ShapeDef } from '../library/types'
import type { FrameItem, Item, LineItem } from '../types'
import { ContextBar, type ContextActions } from './ContextBar'
import { Toolbar, type ToolState } from './Toolbar'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)
const click = async (el: Element | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

const CLOUD: ShapeDef = BUILTIN[0].shapes.find((shape) => shape.id === 'cloud')!

function tools(state: Partial<ToolState>, extra: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const set = vi.fn()
  const full: ToolState = { tool: 'select', shape: 'round', note: 'yellow', pen: 'auto', penSize: 3, ...state }
  return { set, view: <Toolbar state={full} set={set} onUpload={() => {}} onLink={() => {}} onCamera={() => {}} onTimer={() => {}} {...extra} /> }
}

describe('the tools', () => {
  it('stand top to bottom and have no hand of their own: selecting moves the board too', async () => {
    const { view } = tools({})
    await act(async () => root.render(view))
    expect(host.querySelector('[role="toolbar"]')?.getAttribute('aria-orientation')).toBe('vertical')
    expect(button('Select (V)')?.getAttribute('aria-pressed')).toBe('true')
    expect(button('Move the board (H)')).toBeUndefined()
  })

  it('show the hand in place of selecting while H holds it, and a click goes back to selecting', async () => {
    const { set, view } = tools({ tool: 'hand' })
    await act(async () => root.render(view))
    expect(button('Select (V)')).toBeUndefined()
    expect(button('Move the board (H)')?.getAttribute('aria-pressed')).toBe('true')
    await click(button('Move the board (H)'))
    expect(set).toHaveBeenCalledWith({ tool: 'select' })
  })

  it('offer the shapes of the library taken last in the shape panel', async () => {
    const pick = vi.fn()
    const { view } = tools({}, { recent: [{ key: 'basic/cloud', def: CLOUD }], onPickShape: pick, activeShape: 'basic/cloud' })
    await act(async () => root.render(view))
    expect(host.querySelector('[data-recent]')).toBeNull()
    await click(button('Shape (S)'))
    const recent = host.querySelector('[data-recent="basic/cloud"]')
    expect(recent?.getAttribute('aria-label')).toBe('Cloud')
    expect(recent?.getAttribute('aria-pressed')).toBe('true')
    await click(recent!)
    expect(pick).toHaveBeenCalledWith('basic/cloud')
    expect(host.querySelector('[data-recent]')).toBeNull()
  })
})

describe('a frame without fill', () => {
  const frame: FrameItem = { id: 'f', kind: 'frame', x: 0, y: 0, w: 200, h: 100, title: 'Answers', color: '#ef4444' }

  async function bar(items: Item[]) {
    let changed: (Item | LineItem)[] = []
    const actions = new Proxy({} as ContextActions, {
      get: (_, key) => (key === 'change' ? (fn: (x: Item | LineItem) => Item | LineItem) => (changed = items.map(fn)) : key === 'mayReveal' ? () => true : () => undefined),
    })
    // A fresh bar each time: an open colour panel would stay open from the last one.
    await act(async () => root.render(<></>))
    await act(async () => root.render(<ContextBar items={items} lines={[]} at={{ x: 300, y: 200 }} actions={actions} />))
    await click(button('Colour'))
    return { toggle: () => click(button('No fill')), changed: () => changed }
  }

  it('is chosen under the colours of a frame, and chosen again the fill comes back', async () => {
    const filled = await bar([frame])
    expect(button('No fill')?.getAttribute('aria-pressed')).toBe('false')
    await filled.toggle()
    expect(filled.changed()).toEqual([{ ...frame, clear: true }])

    const clear = await bar([{ ...frame, clear: true }])
    expect(button('No fill')?.getAttribute('aria-pressed')).toBe('true')
    await clear.toggle()
    expect((clear.changed()[0] as FrameItem).clear).toBeUndefined()
  })

  it('is no choice for the line of a drawing, which has a colour too', async () => {
    await bar([{ id: 'i', kind: 'ink', x: 0, y: 0, w: 100, h: 100, color: 'auto', points: [[0, 0], [10, 10]] } as unknown as Item])
    expect(button('No fill')).toBeUndefined()
  })
})

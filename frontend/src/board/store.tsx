/**
 * The boards of the mock. They live in the browser (localStorage), there is no server yet. The functions are
 * shaped like the calls the real API will offer, so the pages do not change when it comes.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import i18n from '../i18n'
import { seed, type Space } from './demo'
import type { Board, Doc } from './types'

const KEY = 'nexcanvas.mock.v1'

interface State {
  spaces: Space[]
  boards: Board[]
}

function load(): State {
  try {
    const text = localStorage.getItem(KEY)
    if (text) return JSON.parse(text) as State
  } catch {
    // Then the demo starts fresh.
  }
  return seed(i18n.language)
}

/** False when the browser has no room left (big photos dropped on a board). */
function store(state: State): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

interface Boards {
  spaces: Space[]
  boards: Board[]
  /** Set when the last change could not be kept in the browser. */
  full: boolean
  board: (id: string) => Board | undefined
  space: (id: string) => Space | undefined
  create: (space: string, title: string) => string
  saveDoc: (id: string, doc: Doc) => void
  patch: (id: string, change: Partial<Board>) => void
  duplicate: (id: string, title: string) => string
  trash: (id: string) => void
  restore: (id: string) => void
  purge: (id: string) => void
  reset: () => void
}

const Context = createContext<Boards | null>(null)

export function BoardsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const first = load()
    store(first)
    return first
  })
  const [full, setFull] = useState(false)

  const change = useCallback((update: (old: State) => State) => {
    setState((old) => {
      const next = update(old)
      setFull(!store(next))
      return next
    })
  }, [])

  const value = useMemo<Boards>(() => {
    const touch = (id: string, change: Partial<Board>) => (old: State): State => ({
      ...old,
      boards: old.boards.map((b) => (b.id === id ? { ...b, ...change } : b)),
    })
    return {
      spaces: state.spaces,
      boards: state.boards,
      full,
      board: (id) => state.boards.find((b) => b.id === id),
      space: (id) => state.spaces.find((s) => s.id === id),
      create: (space, title) => {
        const id = 'b-' + Math.random().toString(36).slice(2, 9)
        const now = Date.now()
        change((old) => ({
          ...old,
          boards: [{ id, title, space, items: [], lines: [], created: now, updated: now, opened: now, favorite: false, publicLink: false }, ...old.boards],
        }))
        return id
      },
      saveDoc: (id, doc) => change(touch(id, { items: doc.items, lines: doc.lines, updated: Date.now() })),
      patch: (id, patch) => change(touch(id, patch)),
      duplicate: (id, title) => {
        const copy = 'b-' + Math.random().toString(36).slice(2, 9)
        const now = Date.now()
        change((old) => {
          const source = old.boards.find((b) => b.id === id)
          if (!source) return old
          return { ...old, boards: [{ ...structuredClone(source), id: copy, title, created: now, updated: now, opened: now, favorite: false, publicLink: false }, ...old.boards] }
        })
        return copy
      },
      trash: (id) => change(touch(id, { deleted: Date.now() })),
      restore: (id) => change(touch(id, { deleted: undefined })),
      purge: (id) => change((old) => ({ ...old, boards: old.boards.filter((b) => b.id !== id) })),
      reset: () => {
        const fresh = seed(i18n.language)
        change(() => fresh)
      },
    }
  }, [state, full, change])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBoards(): Boards {
  const value = useContext(Context)
  if (!value) throw new Error('useBoards outside BoardsProvider')
  return value
}

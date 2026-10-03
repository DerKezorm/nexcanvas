/**
 * Spaces and boards as the overview knows them, from the server. The content of an open board does not come from
 * here but over its live connection (`canvas/useLiveDoc.ts`); the pictures here are what the server last wrote.
 *
 * Changes go to the server first and the lists are loaded again after; the lists also refresh when the tab comes
 * back into view and every half minute, so boards others made show up.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { boardsApi, spacesApi, type BoardInfo, type SpaceInfo } from '../api/client'
import type { Background, Board, Doc, Item, LineItem } from './types'

export type Space = SpaceInfo

const REFRESH_MS = 30_000

// eslint-disable-next-line react-refresh/only-export-components
export function toBoard(info: BoardInfo): Board {
  const picture = info.picture ?? { items: [], lines: [] }
  return {
    id: info.id,
    title: info.title,
    space: info.space_id,
    created: Date.parse(info.created_at),
    updated: Date.parse(info.updated_at),
    updatedBy: info.updated_by,
    opened: info.opened_at ? Date.parse(info.opened_at) : 0,
    favorite: info.favorite,
    publicLink: info.public,
    deleted: info.deleted_at ? Date.parse(info.deleted_at) : undefined,
    role: info.role,
    items: picture.items as unknown as Item[],
    lines: picture.lines as unknown as LineItem[],
    background: (picture as { background?: Background }).background,
    defs: (picture as { defs?: Board['defs'] }).defs,
  }
}

interface Boards {
  loaded: boolean
  spaces: Space[]
  boards: Board[]
  bin: Board[]
  board: (id: string) => Board | undefined
  space: (id: number) => Space | undefined
  refresh: () => Promise<void>
  loadBin: () => Promise<void>
  create: (space: number, title: string, content?: Doc) => Promise<string>
  patch: (id: string, change: { title?: string; favorite?: boolean; space?: number }) => Promise<void>
  duplicate: (id: string, title: string) => Promise<string>
  trash: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  purge: (id: string) => Promise<void>
  /** The board's entry changed elsewhere (opened, picture): put it in the list without a full reload. */
  put: (board: Board) => void
  createSpace: (name: string, color?: string) => Promise<Space>
}

const Context = createContext<Boards | null>(null)

export function BoardsProvider({ children }: { children: ReactNode }) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [bin, setBin] = useState<Board[]>([])
  const [loaded, setLoaded] = useState(false)
  const running = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    if (running.current) return running.current
    running.current = (async () => {
      try {
        const [spaceList, boardList] = await Promise.all([spacesApi.list(), boardsApi.list()])
        setSpaces(spaceList)
        setBoards(boardList.map(toBoard))
        setLoaded(true)
      } finally {
        running.current = null
      }
    })()
    return running.current
  }, [])

  const loadBin = useCallback(async () => {
    setBin((await boardsApi.list({ deleted: true })).map(toBoard))
  }, [])

  useEffect(() => {
    void refresh().catch(() => undefined)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined)
    }, REFRESH_MS)
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])

  const value = useMemo<Boards>(() => {
    const replace = (board: Board) => setBoards((list) => (list.some((b) => b.id === board.id) ? list.map((b) => (b.id === board.id ? board : b)) : [board, ...list]))
    return {
      loaded,
      spaces,
      boards,
      bin,
      board: (id) => boards.find((b) => b.id === id),
      space: (id) => spaces.find((s) => s.id === id),
      refresh,
      loadBin,
      create: async (space, title, content) => {
        const made = toBoard(await boardsApi.create(space, title, content))
        replace(made)
        void refresh().catch(() => undefined)
        return made.id
      },
      patch: async (id, change) => {
        if (change.favorite !== undefined) {
          setBoards((list) => list.map((b) => (b.id === id ? { ...b, favorite: change.favorite! } : b)))
          await boardsApi.favorite(id, change.favorite)
        }
        if (change.title !== undefined || change.space !== undefined) {
          replace(toBoard(await boardsApi.change(id, { title: change.title, space_id: change.space })))
        }
      },
      duplicate: async (id, title) => {
        const made = toBoard(await boardsApi.copy(id, title))
        replace(made)
        return made.id
      },
      trash: async (id) => {
        setBoards((list) => list.filter((b) => b.id !== id))
        await boardsApi.trash(id)
        void refresh().catch(() => undefined)
      },
      restore: async (id) => {
        await boardsApi.restore(id)
        await Promise.all([refresh(), loadBin()])
      },
      purge: async (id) => {
        await boardsApi.purge(id)
        await loadBin()
      },
      put: replace,
      createSpace: async (name, color) => {
        const made = await spacesApi.create(name, color)
        await refresh()
        return made
      },
    }
  }, [loaded, spaces, boards, bin, refresh, loadBin])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBoards(): Boards {
  const value = useContext(Context)
  if (!value) throw new Error('useBoards outside BoardsProvider')
  return value
}

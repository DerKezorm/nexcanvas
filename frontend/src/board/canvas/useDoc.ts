import { useCallback, useRef, useState } from 'react'

import type { Doc } from '../types'

const LIMIT = 200

/**
 * The board being edited, with undo and redo. A change either goes into the history at once (`commit`) or runs
 * live during a drag (`live`); a drag calls `checkpoint` on its first move, so the whole drag is one step.
 */
export function useDoc(initial: Doc) {
  const [doc, setDoc] = useState<Doc>(initial)
  const current = useRef(doc)
  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const [, bump] = useState(0)
  // Counts changes made by someone; measuring a text's height is not one and must not mark the board as changed.
  const [version, setVersion] = useState(0)

  const put = useCallback((next: Doc, quiet = false) => {
    current.current = next
    setDoc(next)
    if (!quiet) setVersion((v) => v + 1)
  }, [])

  const checkpoint = useCallback(() => {
    past.current.push(current.current)
    if (past.current.length > LIMIT) past.current.shift()
    future.current = []
    bump((n) => n + 1)
  }, [])

  const commit = useCallback(
    (update: (doc: Doc) => Doc) => {
      checkpoint()
      put(update(current.current))
    },
    [checkpoint, put],
  )

  const live = useCallback((update: (doc: Doc) => Doc) => put(update(current.current)), [put])

  const quiet = useCallback((update: (doc: Doc) => Doc) => put(update(current.current), true), [put])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(current.current)
    put(prev)
    bump((n) => n + 1)
  }, [put])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(current.current)
    put(next)
    bump((n) => n + 1)
  }, [put])

  /** Drops the last checkpoint again, for a drag that ended without moving anything. */
  const forget = useCallback(() => {
    past.current.pop()
    bump((n) => n + 1)
  }, [])

  return {
    doc,
    version,
    ref: current,
    quiet,
    commit,
    live,
    checkpoint,
    forget,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}

export type DocState = ReturnType<typeof useDoc>

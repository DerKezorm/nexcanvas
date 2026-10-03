/**
 * Where a board finds the shapes of packages: the shipped ones from the code, the others from the board itself (it
 * carries every shape it uses, so everybody sees them) or, for placing new ones, from the packages installed for the
 * server and the board's space.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { Item } from '../types'
import { BUILTIN } from './builtin'
import { loadIconPackages } from './icons'
import type { Part, ShapeDef, ShapePackage } from './types'

export type Lookup = (key: string) => ShapeDef | undefined

const SHIPPED = new Map<string, ShapeDef>()
for (const pkg of BUILTIN) for (const shape of pkg.shapes) SHIPPED.set(`${pkg.id}/${shape.id}`, shape)
const SHIPPED_IDS = new Set(BUILTIN.map((p) => p.id))

/** Whether a key belongs to a package that comes with nexcanvas (never carried by a board). */
export function shipped(key: string): boolean {
  return SHIPPED_IDS.has(key.split('/')[0])
}

/** A lookup over the shipped shapes, a board's own, and installed packages, in that order. */
export function makeLookup(installed: ShapePackage[] = [], defs: Record<string, ShapeDef> = {}): Lookup {
  const more = new Map<string, ShapeDef>()
  for (const pkg of installed) for (const shape of pkg.shapes) more.set(`${pkg.id}/${shape.id}`, shape)
  return (key) => SHIPPED.get(key) ?? defs[key] ?? more.get(key)
}

/** The outline of an item that is a shape of a package, as parts of its box; undefined for every other item. */
export function outlineFor(lookup: Lookup) {
  return (item: Item): Part[] | null | undefined => {
    if (item.kind !== 'shape' || !item.lib) return undefined
    return lookup(item.lib)?.outline ?? null
  }
}

export interface Library {
  lookup: Lookup
  /** Every package to place shapes from: shipped first, then the server's, then the space's (enabled ones). */
  packages: ShapePackage[]
  reload: () => void
}

const EMPTY: Library = { lookup: makeLookup(), packages: BUILTIN, reload: () => undefined }

export const LibraryContext = createContext<Library>(EMPTY)

export function useLibrary(): Library {
  return useContext(LibraryContext)
}

/** The packages installed for the server and the space, kept fresh on demand. */
export function useInstalled(space: number | undefined): { installed: ShapePackage[]; reload: () => void } {
  const [installed, setInstalled] = useState<ShapePackage[]>([])
  const [round, setRound] = useState(0)
  useEffect(() => {
    let alive = true
    api<ShapePackage[]>('/api/shape-packages', { query: space ? { space } : {} }).then(
      (list) => alive && setInstalled(list),
      () => alive && setInstalled([]),
    )
    return () => {
      alive = false
    }
  }, [space, round])
  const reload = useCallback(() => setRound((n) => n + 1), [])
  return { installed, reload }
}

/** The icon packages, loaded once the first board opens (they are large, and a board carries the ones it uses). */
export function useIconPackages(): ShapePackage[] {
  const [icons, setIcons] = useState<ShapePackage[]>([])
  useEffect(() => {
    let alive = true
    loadIconPackages().then(
      (list) => alive && setIcons(list),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  return icons
}

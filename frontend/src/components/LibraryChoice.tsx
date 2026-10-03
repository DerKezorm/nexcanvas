import { Shapes } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, authApi, type Me } from '../api/client'
import { BUILTIN } from '../board/library/builtin'
import { ICON_PACKAGES, loadIconPackages } from '../board/library/icons'
import { ShapeTile } from '../board/library/LibShape'
import { named, type ShapePackage } from '../board/library/types'
import { useBoards } from '../board/store'
import { Button, Feedback, SubHead } from '../pages/settings/ui'
import { useAuth } from '../state/auth'
import { Section } from './Section'

/** Four shapes spread over the package, as its picture. */
function sample(pkg: ShapePackage) {
  const n = pkg.shapes.length
  if (n <= 4) return pkg.shapes
  return [0, 1, 2, 3].map((i) => pkg.shapes[Math.floor((i * n) / 4)])
}

/**
 * Which packages the own library on the board shows: each one on or off, for this account only. What is already on a
 * board stays drawn; a package switched off only leaves the library.
 */
export function LibraryChoice({ me }: { me: Me }) {
  const { t, i18n } = useTranslation()
  const { setMe } = useAuth()
  const boards = useBoards()
  const [icons, setIcons] = useState<ShapePackage[]>([])
  const [installed, setInstalled] = useState<ShapePackage[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const hidden = useMemo(() => new Set(me.preferences?.library_hidden ?? []), [me])
  const spaceIds = useMemo(() => boards.spaces.map((s) => s.id).join(','), [boards.spaces])

  useEffect(() => {
    let alive = true
    loadIconPackages().then((list) => alive && setIcons(list), () => undefined)
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    let alive = true
    const asks = [undefined, ...spaceIds.split(',').filter(Boolean).map(Number)].map((space) => api<ShapePackage[]>('/api/shape-packages', { query: space ? { space } : {} }).catch(() => []))
    Promise.all(asks).then((lists) => {
      if (!alive) return
      const seen = new Map<string, ShapePackage>()
      for (const pkg of lists.flat()) if (pkg.enabled !== false) seen.set(pkg.id, pkg)
      setInstalled([...seen.values()])
    })
    return () => {
      alive = false
    }
  }, [spaceIds])

  const save = (next: Set<string>) => {
    setProblem(null)
    const before = me
    const library_hidden = [...next]
    setMe({ ...me, preferences: { ...me.preferences, library_hidden } } as Me)
    authApi.preferences({ library_hidden }).then(
      (preferences) => setMe({ ...me, preferences } as Me),
      () => {
        setMe(before)
        setProblem('internal_error')
      },
    )
  }
  const switchOne = (id: string, on: boolean) => {
    const next = new Set(hidden)
    if (on) next.delete(id)
    else next.add(id)
    save(next)
  }
  const switchAll = (ids: string[], on: boolean) => {
    const next = new Set(hidden)
    for (const id of ids) {
      if (on) next.delete(id)
      else next.add(id)
    }
    save(next)
  }

  const iconPackages: ShapePackage[] = ICON_PACKAGES.map((known) => icons.find((p) => p.id === known.id) ?? { id: known.id, name: known.name, version: '', author: '', license: '', shapes: [] })

  const group = (title: string, text: string, packages: ShapePackage[]) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SubHead title={title} text={text} />
        <div className="flex gap-1.5">
          <Button small onClick={() => switchAll(packages.map((p) => p.id), true)}>
            {t('libraryChoice.allOn')}
          </Button>
          <Button small onClick={() => switchAll(packages.map((p) => p.id), false)}>
            {t('libraryChoice.allOff')}
          </Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {packages.map((pkg) => {
          const name = named(pkg.name, i18n.language)
          const on = !hidden.has(pkg.id)
          return (
            <label key={pkg.id} data-package-choice={pkg.id} className={'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ' + (on ? 'border-ink-700 bg-ink-850' : 'border-ink-800 bg-ink-900 opacity-70')}>
              <span className="flex shrink-0 gap-0.5" aria-hidden>
                {sample(pkg).map((def) => (
                  <ShapeTile key={def.id} def={def} size={22} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-mist-100">{name}</span>
                <span className="block text-xs text-mist-500">{pkg.shapes.length ? t('libraryChoice.count', { count: pkg.shapes.length }) : '…'}</span>
              </span>
              <input type="checkbox" checked={on} onChange={(e) => switchOne(pkg.id, e.target.checked)} aria-label={name} className="h-5 w-5 shrink-0 accent-accent-500" />
            </label>
          )
        })}
      </div>
    </div>
  )

  return (
    <Section icon={Shapes} title={t('libraryChoice.title')} id="library-choice">
      <div className="space-y-4">
        <p className="text-sm text-mist-400">{t('libraryChoice.text')}</p>
        <Feedback problem={problem} />
        {group(t('libraryChoice.shipped'), t('libraryChoice.shippedText'), BUILTIN)}
        {group(t('libraryChoice.icons'), t('libraryChoice.iconsText'), iconPackages)}
        {installed.length > 0 && group(t('libraryChoice.installed'), t('libraryChoice.installedText'), installed)}
      </div>
    </Section>
  )
}

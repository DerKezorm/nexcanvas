import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../../api/client'
import { Dialog } from '../../components/Dialog'
import { errorText } from '../../lib/errors'
import type { Item } from '../types'
import { selectionToShape } from './convert'
import { ShapeTile } from './LibShape'
import { useLibrary } from './registry'
import { named, type ShapePackage } from './types'

type Installed = ShapePackage & { key: number }
const NEW = 'new'

/**
 * What is selected, saved as one shape into a package of the board's space (a new one "Own shapes" when there is
 * none yet): it then lies in the library of everybody in the space, to drag out as often as wanted.
 */
export function SaveShapeDialog({ items, space, onClose, onSaved }: { items: Item[]; space: number; onClose: () => void; onSaved: (name: string) => void }) {
  const { t, i18n } = useTranslation()
  const { lookup, reload } = useLibrary()
  const [name, setName] = useState('')
  const [packages, setPackages] = useState<Installed[] | null>(null)
  const [target, setTarget] = useState<string>(NEW)
  const [problem, setProblem] = useState<{ code: string; values: Record<string, unknown> } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<Installed[]>('/api/shape-packages', { query: { space } }).then(
      (all) => {
        const own = all.filter((p) => p.scope === 'space')
        setPackages(own)
        if (own.length) setTarget(String(own[0].key))
      },
      () => setPackages([]),
    )
  }, [space])

  const preview = selectionToShape(items, name.trim() || t('saveShape.placeholder'), lookup)
  const save = async () => {
    const made = selectionToShape(items, name.trim(), lookup).shape
    if (!made) return
    setBusy(true)
    setProblem(null)
    try {
      const into = packages?.find((p) => String(p.key) === target)
      if (into) {
        await api(`/api/shape-packages/${into.key}`, { method: 'PUT', body: { package: { name: into.name, version: into.version, author: into.author, license: into.license, shapes: [...into.shapes, made] } } })
      } else {
        await api('/api/shape-packages', { method: 'POST', body: { space, package: { name: { de: t('saveShape.ownDe'), en: t('saveShape.ownEn') }, version: '1.0.0', shapes: [made] } } })
      }
      reload()
      onSaved(name.trim())
    } catch (error) {
      setProblem(error instanceof ApiError ? { code: error.code, values: error.values } : { code: 'internal_error', values: {} })
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('saveShape.title')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl border border-ink-700 bg-ink-850">{preview.shape && <ShapeTile def={preview.shape} size={60} />}</div>
          <label className="block flex-1 text-sm">
            <span className="text-xs font-medium text-mist-400">{t('saveShape.name')}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('saveShape.placeholder')} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none focus:border-accent-500" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-xs font-medium text-mist-400">{t('saveShape.package')}</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-2 text-sm text-mist-100">
            {packages?.map((p) => (
              <option key={p.key} value={String(p.key)}>
                {named(p.name, i18n.language)}
              </option>
            ))}
            <option value={NEW}>{t('saveShape.newPackage')}</option>
          </select>
        </label>
        {preview.left > 0 && <p className="text-xs text-mist-500">{t('saveShape.left', { count: preview.left })}</p>}
        {!preview.shape && <p className="text-sm text-warn-500">{t('saveShape.nothing')}</p>}
        {problem && (
          <p role="alert" className="text-sm text-bad-500">
            {errorText(problem.code, problem.values)}
          </p>
        )}
        <p className="text-xs text-mist-500">{t('saveShape.where')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent" disabled={busy || !name.trim() || !preview.shape || packages === null}>
            {t('saveShape.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

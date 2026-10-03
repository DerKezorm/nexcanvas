import { ChevronDown, ChevronRight, Download, FileUp, Plus, Shapes, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../api/client'
import { svgToShape } from '../board/library/convert'
import { ShapeTile } from '../board/library/LibShape'
import { named, type ShapeDef, type ShapePackage } from '../board/library/types'
import { errorText } from '../lib/errors'
import { Button, Confirm, Feedback } from '../pages/settings/ui'

type Installed = ShapePackage & { key: number }

/** What went wrong, as an error code with its values (the server says which shape and field a package fails on). */
function trouble(error: unknown): { code: string; values: Record<string, unknown> } {
  if (error instanceof ApiError) return { code: error.code, values: error.values }
  const local = error instanceof Error ? error.message : ''
  return { code: ['not_svg', 'empty_svg', 'not_json'].includes(local) ? `packages_${local}` : 'internal_error', values: {} }
}

/** The parts of a package the server keeps (no key, scope or switch). */
function body(pkg: ShapePackage, shapes: ShapeDef[] = pkg.shapes) {
  return { name: pkg.name, version: pkg.version, author: pkg.author, license: pkg.license, shapes }
}

/**
 * The shape packages of a space, or of the whole server (`space` null): each with its shapes, switched on or off,
 * passed on as a file, shapes added from SVG files or taken out; new packages empty or from a file.
 */
export function PackageList({ space, canChange }: { space: number | null; canChange: boolean }) {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState<Installed[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [problem, setProblem] = useState<{ code: string; values: Record<string, unknown> } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState('')
  const [removing, setRemoving] = useState<Installed | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const svgInput = useRef<HTMLInputElement>(null)
  const svgFor = useRef<Installed | null>(null)

  const load = useCallback(() => {
    api<Installed[]>('/api/shape-packages', { query: space ? { space } : {} }).then(
      (all) => setList(all.filter((p) => (space ? p.scope === 'space' : p.scope === 'server'))),
      (error) => setProblem(trouble(error)),
    )
  }, [space])
  useEffect(load, [load])

  const run = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      await work()
      if (success) setDone(success)
      load()
    } catch (error) {
      setProblem(trouble(error))
    } finally {
      setBusy(false)
    }
  }

  const replace = (pkg: Installed, shapes: ShapeDef[]) => api(`/api/shape-packages/${pkg.key}`, { method: 'PUT', body: { package: body(pkg, shapes) } })

  return (
    <div className="space-y-3" data-testid="packages">
      {list?.length === 0 && <p className="text-sm text-mist-500">{t('packages.none')}</p>}
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700 empty:hidden">
        {list?.map((pkg) => {
          const isOpen = open === pkg.key
          return (
            <li key={pkg.key} className="px-4 py-3 text-sm" data-package-key={pkg.key}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpen(isOpen ? null : pkg.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-mist-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-mist-500" />}
                  <span className="truncate font-medium text-mist-100">{named(pkg.name, i18n.language)}</span>
                  <span className="shrink-0 text-xs text-mist-500">
                    {t('packages.shapes', { count: pkg.shapes.length })} · {pkg.version}
                    {pkg.author ? ` · ${pkg.author}` : ''}
                    {pkg.license ? ` · ${pkg.license}` : ''}
                  </span>
                </button>
                {canChange && (
                  <label className="flex items-center gap-1.5 text-xs text-mist-400">
                    <input type="checkbox" checked={pkg.enabled !== false} onChange={(e) => {
                      // The switch moves at once; a refusal puts it back with the list loaded again.
                      const on = e.target.checked
                      setList((all) => all?.map((p) => (p.key === pkg.key ? { ...p, enabled: on } : p)) ?? all)
                      void run(() => api(`/api/shape-packages/${pkg.key}`, { method: 'PUT', body: { enabled: on } }))
                    }} className="h-4 w-4 accent-accent-500" />
                    {t('packages.on')}
                  </label>
                )}
                {canChange && (
                  <Button small busy={busy} onClick={() => {
                    svgFor.current = pkg
                    svgInput.current?.click()
                  }}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('packages.addSvg')}
                  </Button>
                )}
                <a href={`/api/shape-packages/${pkg.key}/file`} download className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-0.5 text-xs text-mist-300 hover:bg-ink-850">
                  <Download className="h-3.5 w-3.5" />
                  {t('packages.download')}
                </a>
                {canChange && (
                  <Button small danger onClick={() => setRemoving(pkg)} label={t('packages.remove')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {isOpen && (
                <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                  {pkg.shapes.length === 0 && <p className="col-span-full text-xs text-mist-500">{t('packages.empty')}</p>}
                  {pkg.shapes.map((shape) => (
                    <div key={shape.id} className="group relative rounded-xl border border-ink-700 bg-ink-850 p-2 text-center">
                      <div className="grid h-12 place-items-center">
                        <ShapeTile def={shape} size={40} />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-mist-400" title={named(shape.name, i18n.language)}>
                        {named(shape.name, i18n.language)}
                      </p>
                      {canChange && (
                        <button
                          type="button"
                          onClick={() => void run(() => replace(pkg, pkg.shapes.filter((s) => s.id !== shape.id)))}
                          aria-label={t('packages.removeShape', { name: named(shape.name, i18n.language) })}
                          className="absolute top-1 right-1 rounded p-0.5 text-mist-600 opacity-0 group-hover:opacity-100 hover:text-bad-500 focus-visible:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {canChange && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-48 flex-1 text-sm">
            <span className="text-xs font-medium text-mist-400">{t('packages.newName')}</span>
            <input value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={t('packages.newPlaceholder')} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none focus:border-accent-500" />
          </label>
          <Button
            accent
            busy={busy}
            disabled={!naming.trim()}
            onClick={() =>
              void run(async () => {
                await api('/api/shape-packages', { method: 'POST', body: { space, package: { name: { de: naming.trim(), en: naming.trim() }, version: '1.0.0', shapes: [] } } })
                setNaming('')
              }, t('packages.made'))
            }
          >
            <Shapes className="h-4 w-4" />
            {t('packages.new')}
          </Button>
          <Button busy={busy} onClick={() => fileInput.current?.click()}>
            <FileUp className="h-4 w-4" />
            {t('packages.import')}
          </Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm text-bad-500">
          {errorText(problem.code, problem.values)}
        </p>
      )}
      <Feedback problem={null} done={done} />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          void run(async () => {
            let parsed: unknown
            try {
              parsed = JSON.parse(await file.text())
            } catch {
              throw new Error('not_json')
            }
            await api('/api/shape-packages', { method: 'POST', body: { space, package: parsed } })
          }, t('packages.imported'))
        }}
      />
      <input
        ref={svgInput}
        type="file"
        accept="image/svg+xml,.svg"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          const pkg = svgFor.current
          if (!files.length || !pkg) return
          void run(async () => {
            const made: ShapeDef[] = []
            for (const file of files) made.push(svgToShape(await file.text(), file.name))
            await replace(pkg, [...pkg.shapes, ...made])
            setOpen(pkg.key)
          }, t('packages.svgAdded', { count: files.length }))
        }}
      />
      {removing && (
        <Confirm
          title={t('packages.removeTitle', { name: named(removing.name, i18n.language) })}
          text={t('packages.removeText')}
          confirm={t('packages.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/shape-packages/${removing.key}`, { method: 'DELETE' })
            setRemoving(null)
            load()
          }}
        />
      )}
      <p className="text-xs text-mist-500">{t('packages.boardsKeep')}</p>
    </div>
  )
}

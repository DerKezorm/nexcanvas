import { Download, FileUp, LayoutTemplate, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../api/client'
import { useBoards } from '../board/store'
import { Thumb } from '../board/Thumb'
import { CATALOG, CATEGORIES, catalogDoc, type OwnTemplate } from '../board/templates'
import type { Board, Doc } from '../board/types'
import { useShell } from '../components/AppShell'
import { Dialog } from '../components/Dialog'
import { TEMPLATE_ICONS, useOwnTemplates } from '../components/Templates'
import { errorText } from '../lib/errors'
import { useAuth } from '../state/auth'
import { Confirm } from './settings/ui'

function asBoard(id: string, doc: Doc): Board {
  return { id, title: id, items: doc.items, lines: doc.lines, background: doc.background, defs: doc.defs, created: 0, updated: 0, updatedBy: '', opened: 0, favorite: false, space: 0, publicLink: false, role: null }
}

/**
 * Starting points, each with a picture of what it puts on the board: the shipped ones in their groups, and the ones
 * spaces and the server keep, which their managers rename, pass on as files, bring in from files and remove.
 */
export function TemplatesPage() {
  const { t, i18n } = useTranslation()
  const shell = useShell()
  const boards = useBoards()
  const { me } = useAuth()
  const operator = me?.role === 'operator'
  const spaceIds = useMemo(() => boards.spaces.map((s) => s.id), [boards.spaces])
  const own = useOwnTemplates(spaceIds)
  const managed = boards.spaces.filter((s) => s.role === 'manage')
  const mayChange = (template: OwnTemplate) => (template.scope === 'server' ? operator : managed.some((s) => s.id === template.space))
  const [renaming, setRenaming] = useState<OwnTemplate | null>(null)
  const [removing, setRemoving] = useState<OwnTemplate | null>(null)
  const [importing, setImporting] = useState(false)
  const say = (key: string, values?: Record<string, unknown>) => t(key, values as never) as unknown as string
  const docs = useMemo(() => new Map(CATALOG.map(({ id }) => [id, catalogDoc(id, say, i18n.language)])), [i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  const card = (key: string, name: string, hint: string, doc: Doc, onOpen: () => void, Icon: typeof LayoutTemplate, tools?: React.ReactNode) => (
    <div key={key} className="group overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 transition-colors hover:border-accent-500/60" data-template-card={key}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="aspect-[16/10] border-b border-ink-700/70">
          <Thumb board={asBoard(key, doc)} />
        </div>
        <div className="flex items-start gap-3 p-3.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-mist-500 group-hover:text-accent-400" strokeWidth={1.8} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-mist-100">{name}</span>
            <span className="block text-xs text-mist-600">{hint}</span>
          </span>
        </div>
      </button>
      {tools && <div className="flex gap-1 border-t border-ink-700/70 px-2.5 py-1.5">{tools}</div>}
    </div>
  )
  const tool = 'rounded-lg p-1.5 text-mist-500 hover:bg-ink-800 hover:text-mist-100'

  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('nav.templates')}</h1>
            <p className="mt-1 text-sm text-mist-600">{t('templates.intro')}</p>
          </div>
          {(managed.length > 0 || operator) && (
            <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-3.5 py-1.5 text-sm text-mist-300 hover:bg-ink-850">
              <FileUp className="h-4 w-4" strokeWidth={1.8} />
              {t('templates.import.button')}
            </button>
          )}
        </div>

        {own.list.length > 0 && (
          <section className="mt-8" data-testid="own-templates">
            <h2 className="text-sm font-semibold tracking-wide text-mist-400 uppercase">{t('templates.own')}</h2>
            <div className="mt-3 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {own.list.map((template) =>
                card(
                  `own-${template.key}`,
                  template.name,
                  template.scope === 'server' ? t('templates.scope.server') : t('templates.inSpace', { space: boards.space(template.space ?? 0)?.name ?? '' }),
                  template.content,
                  () => shell.newBoard(template.space ?? undefined, `own:${template.key}`),
                  LayoutTemplate,
                  <>
                    <a href={`/api/board-templates/${template.key}/file`} download className={tool} title={t('templates.download')} aria-label={t('templates.download')}>
                      <Download className="h-4 w-4" />
                    </a>
                    {mayChange(template) && (
                      <>
                        <button type="button" className={tool} title={t('templates.rename')} aria-label={t('templates.rename')} onClick={() => setRenaming(template)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" className={tool + ' hover:text-bad-500'} title={t('templates.remove')} aria-label={t('templates.remove')} onClick={() => setRemoving(template)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </>,
                ),
              )}
            </div>
          </section>
        )}

        {CATEGORIES.map((category) => (
          <section key={category} className="mt-8">
            <h2 className="text-sm font-semibold tracking-wide text-mist-400 uppercase">{t(`templates.categories.${category}`)}</h2>
            <div className="mt-3 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {CATALOG.filter((entry) => entry.category === category).map(({ id }) =>
                card(id, t(`templates.${id}.name`), t(`templates.${id}.hint`), docs.get(id) ?? { items: [], lines: [] }, () => shell.newBoard(undefined, id), TEMPLATE_ICONS[id] ?? LayoutTemplate),
              )}
            </div>
          </section>
        ))}
      </div>
      {renaming && <RenameDialog template={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); own.reload() }} />}
      {removing && (
        <Confirm
          title={t('templates.removeTitle', { name: removing.name })}
          text={t('templates.removeText')}
          confirm={t('templates.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/api/board-templates/${removing.key}`, { method: 'DELETE' })
            setRemoving(null)
            own.reload()
          }}
        />
      )}
      {importing && <ImportDialog spaces={managed.map((s) => ({ id: s.id, name: s.name }))} operator={operator} onClose={() => setImporting(false)} onDone={() => { setImporting(false); own.reload() }} />}
    </main>
  )
}

function RenameDialog({ template, onClose, onDone }: { template: OwnTemplate; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(template.name)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Dialog title={t('templates.rename')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          api(`/api/board-templates/${template.key}`, { method: 'PUT', body: { name: name.trim() } }).then(onDone, (error) => setProblem(error instanceof ApiError ? error.code : 'internal_error'))
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={t('templates.save.name')} className="h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-100 outline-none focus:border-accent-500" />
        {problem && <p className="text-sm text-bad-500">{errorText(problem)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn nc-btn-accent" disabled={!name.trim()}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** A template file brought in, for a space one manages or, for the operator, for everybody. */
function ImportDialog({ spaces, operator, onClose, onDone }: { spaces: { id: number; name: string }[]; operator: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [where, setWhere] = useState<string>(spaces[0] ? String(spaces[0].id) : 'server')
  const [problem, setProblem] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  return (
    <Dialog title={t('templates.import.title')} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="text-xs font-medium text-mist-400">{t('templates.import.where')}</span>
          <select value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-ink-700 bg-ink-850 px-2 text-sm text-mist-100">
            {spaces.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
            {operator && <option value="server">{t('templates.save.server')}</option>}
          </select>
        </label>
        {problem && <p role="alert" className="text-sm text-bad-500">{errorText(problem)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="nc-btn nc-btn-accent" onClick={() => file.current?.click()}>
            {t('templates.import.choose')}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const chosen = e.target.files?.[0]
            e.target.value = ''
            if (!chosen) return
            setProblem(null)
            let parsed: { format?: string; name?: string; content?: unknown }
            try {
              parsed = JSON.parse(await chosen.text())
            } catch {
              setProblem('template_not_json')
              return
            }
            if (parsed?.format !== 'nexcanvas-template' || typeof parsed.content !== 'object') {
              setProblem('template_not_json')
              return
            }
            api('/api/board-templates', { method: 'POST', body: { space: where === 'server' ? null : Number(where), name: String(parsed.name ?? chosen.name.replace(/\.json$/i, '')).slice(0, 120), content: parsed.content } }).then(
              onDone,
              (error) => setProblem(error instanceof ApiError ? error.code : 'internal_error'),
            )
          }}
        />
      </div>
    </Dialog>
  )
}

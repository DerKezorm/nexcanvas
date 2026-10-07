import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, boardsApi } from '../../api/client'
import { Dialog } from '../../components/Dialog'
import { errorText } from '../../lib/errors'
import { ago, moment } from '../../lib/time'

type Version = { id: number; created_at: string; authors: string; items: number }

/** Earlier states of the board. Bringing one back is itself a change everybody sees live, and can be undone the same way. */
export function VersionsDialog({ boardId, readOnly, onClose }: { boardId: string; readOnly: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState<Version[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState<Version | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let gone = false
    boardsApi.versions(boardId).then(
      (list) => !gone && setRows(list),
      (error) => !gone && setProblem(error instanceof ApiError ? error.code : 'internal_error'),
    )
    return () => {
      gone = true
    }
  }, [boardId])

  const restore = async (version: Version) => {
    setBusy(true)
    setProblem(null)
    try {
      await boardsApi.restoreVersion(boardId, version.id)
      onClose()
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'internal_error')
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('board.versions')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-mist-500">{t('versions.lead')}</p>
        {problem && <p role="alert" className="text-sm text-bad-500">{errorText(problem)}</p>}
        {rows === null && !problem && <p className="text-sm text-mist-500">{t('common.loading')}</p>}
        {rows?.length === 0 && <p className="text-sm text-mist-500">{t('versions.none')}</p>}
        {rows && rows.length > 0 && (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {rows.map((row) => {
              const when = new Date(row.created_at.endsWith('Z') || row.created_at.includes('+') ? row.created_at : row.created_at + 'Z')
              return (
                <li key={row.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink-850">
                  <History className="h-4 w-4 shrink-0 text-mist-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-mist-100" title={moment(when, i18n.language)}>
                      {ago(when.getTime(), i18n.language)}
                    </p>
                    <p className="truncate text-xs text-mist-500">
                      {t('versions.items', { count: row.items })}
                      {row.authors && ' · ' + row.authors}
                    </p>
                  </div>
                  {!readOnly &&
                    (asking?.id === row.id ? (
                      <span className="flex shrink-0 gap-1">
                        <button type="button" className="nc-btn nc-btn-ghost px-2 py-1 text-xs" onClick={() => setAsking(null)}>
                          {t('common.cancel')}
                        </button>
                        <button type="button" disabled={busy} className="nc-btn nc-btn-accent px-2 py-1 text-xs" onClick={() => void restore(row)}>
                          {t('versions.restoreNow')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="nc-btn nc-btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => setAsking(row)}>
                        {t('versions.restore')}
                      </button>
                    ))}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

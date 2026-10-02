import { Check, Copy, Globe, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../../api/client'
import { Avatar } from '../../components/Avatar'
import { Dialog } from '../../components/Dialog'
import { MembersDialog } from '../../components/MembersDialog'
import { errorText } from '../../lib/errors'
import { useAuth } from '../../state/auth'
import { useBoards } from '../store'
import type { Board } from '../types'

type ShareState = { link: string; expires_at: string | null; password: boolean }

function CopyField({ value }: { value: string }) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="nc-field font-mono text-xs" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="nc-btn nc-btn-ghost shrink-0"
        onClick={() => {
          void navigator.clipboard?.writeText(value).catch(() => undefined)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? <Check className="h-4 w-4 text-ok-500" /> : <Copy className="h-4 w-4" />}
        {done ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  )
}

/**
 * Who sees the board, built like nexlore's sharing: the members of the space see it with their role, and a public
 * read-only page can be switched on, with expiry and password, if the operator allows public pages.
 */
export function ShareDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const boards = useBoards()
  const space = boards.space(board.space)
  const [members, setMembers] = useState(false)
  const [share, setShare] = useState<ShareState | null>(null)
  const [days, setDays] = useState('30')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const manage = space?.role === 'manage'
  const allowed = me?.shares_allowed ?? false

  useEffect(() => {
    api<ShareState>(`/api/boards/${board.id}/share`).then(setShare, () => setShare(null))
  }, [board.id])

  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.code : 'internal_error')

  const publish = async () => {
    setBusy(true)
    setProblem(null)
    try {
      setShare(await api<ShareState>(`/api/boards/${board.id}/share`, { method: 'PUT', body: { days: days === 'never' ? null : Number(days), password } }))
      setPassword('')
      void boards.refresh()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  if (members && space) return <MembersDialog space={space} onClose={() => setMembers(false)} />
  return (
    <Dialog title={t('share.title', { title: board.title })} onClose={onClose}>
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-mist-100">
          <Users className="h-4 w-4 text-mist-500" />
          {t('share.who')}
        </h3>
        <p className="mt-1 text-xs text-mist-600">{t('share.whoHint', { space: space?.name })}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {space?.members.slice(0, 6).map((m) => (
              <Avatar key={m.id} person={m} className="h-7 w-7 text-xs" ring />
            ))}
          </span>
          <span className="min-w-0 truncate text-xs text-mist-500">{space?.members.map((m) => m.display_name || m.name).join(', ')}</span>
          {manage && (
            <button type="button" onClick={() => setMembers(true)} className="ml-auto shrink-0 text-xs font-semibold text-accent-400 hover:underline">
              {t('share.manage')}
            </button>
          )}
        </div>
        <div className="mt-3">
          <CopyField value={`${location.origin}/b/${board.id}`} />
        </div>
      </section>

      <section className="mt-5 border-t border-ink-700/70 pt-5">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-mist-500" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-mist-100">{t('share.public')}</h3>
            <p className="mt-1 text-xs text-mist-600">{t('share.publicHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={share !== null}
            aria-label={t('share.public')}
            disabled={!manage || !allowed || busy}
            onClick={async () => {
              if (share) {
                try {
                  await api(`/api/boards/${board.id}/share`, { method: 'DELETE' })
                  setShare(null)
                  void boards.refresh()
                } catch (error) {
                  fail(error)
                }
              } else await publish()
            }}
            className={'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ' + (share ? 'bg-accent-500' : 'bg-ink-600')}
          >
            <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (share ? 'left-[22px]' : 'left-0.5')} />
          </button>
        </div>
        {manage && allowed && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-mist-500">{t('share.expiry')}</span>
                <select className="nc-field" value={days} onChange={(e) => setDays(e.target.value)}>
                  {['1', '7', '30', '365', 'never'].map((v) => (
                    <option key={v} value={v}>
                      {v === 'never' ? t('share.never') : t('share.days', { count: Number(v) })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-mist-500">
                  <Lock className="h-3 w-3" />
                  {t('share.password')}
                </span>
                <input className="nc-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={share?.password ? t('share.passwordKept') : t('share.passwordNone')} autoComplete="new-password" />
              </label>
            </div>
            {share && (
              <>
                <CopyField value={share.link} />
                <div className="flex items-center justify-between text-xs text-mist-600">
                  <span>{share.expires_at ? t('share.until', { date: new Date(share.expires_at).toLocaleDateString() }) : t('share.forever')}</span>
                  <button type="button" disabled={busy} onClick={publish} className="font-semibold text-accent-400 hover:underline">
                    {t('share.update')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {!allowed && <p className="mt-3 text-xs text-mist-600">{t('share.operatorOff')}</p>}
        {allowed && !manage && <p className="mt-3 text-xs text-mist-600">{t('share.onlyManagers')}</p>}
        {problem && <p className="mt-3 text-sm text-bad-500">{errorText(problem)}</p>}
      </section>
    </Dialog>
  )
}

import { Check, Copy, Globe, Lock, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar } from '../../components/Avatar'
import { Dialog } from '../../components/Dialog'
import { MembersDialog } from '../../components/MembersDialog'
import { PEOPLE } from '../demo'
import { useBoards } from '../store'
import type { Board } from '../types'

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
 * Who sees the board, built like nexlore's sharing: the members of the space see it with their role, and a
 * public read-only page can be switched on, with expiry and password, if the operator allows public pages.
 */
export function ShareDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { t } = useTranslation()
  const boards = useBoards()
  const space = boards.space(board.space)
  const [members, setMembers] = useState(false)
  const [expiry, setExpiry] = useState('30')
  const [password, setPassword] = useState('')
  const manage = space?.role === 'manage'
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
            {space?.members.map((m) => (
              <Avatar key={m.person} person={m.person} className="h-7 w-7 text-xs" ring />
            ))}
          </span>
          <span className="truncate text-xs text-mist-500">{space?.members.map((m) => PEOPLE.find((p) => p.id === m.person)?.name.split(' ')[0]).join(', ')}</span>
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
            aria-checked={board.publicLink}
            aria-label={t('share.public')}
            disabled={!manage}
            onClick={() => boards.patch(board.id, { publicLink: !board.publicLink })}
            className={'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ' + (board.publicLink ? 'bg-accent-500' : 'bg-ink-600')}
          >
            <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (board.publicLink ? 'left-[22px]' : 'left-0.5')} />
          </button>
        </div>
        {board.publicLink && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-mist-500">{t('share.expiry')}</span>
                <select className="nc-field" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
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
                <input className="nc-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('share.passwordNone')} autoComplete="new-password" />
              </label>
            </div>
            <CopyField value={`${location.origin}/s/${board.id.slice(2)}x7Kq`} />
          </div>
        )}
        {!manage && <p className="mt-3 text-xs text-mist-600">{t('share.onlyManagers')}</p>}
      </section>
    </Dialog>
  )
}

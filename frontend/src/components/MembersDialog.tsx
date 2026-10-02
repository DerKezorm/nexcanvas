import { Check, Copy, Link2, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, spacesApi, type Role } from '../api/client'
import type { Space } from '../board/store'
import { useBoards } from '../board/store'
import { errorText } from '../lib/errors'
import { useAuth } from '../state/auth'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'

type Listing = Awaited<ReturnType<typeof spacesApi.members>>

/**
 * Members of a space and their roles, as in nexlore: read, write, manage. Naming an account sends an invitation it
 * accepts or declines (the answer is the same whether the name exists or not); a link brings in people without one.
 */
export function MembersDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const boards = useBoards()
  const [listing, setListing] = useState<Listing | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('write')
  const [sent, setSent] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const manage = listing?.role === 'manage'

  const load = useCallback(() => {
    spacesApi.members(space.id).then(setListing, (error) => setProblem(error instanceof ApiError ? error.code : 'internal_error'))
  }, [space.id])
  useEffect(load, [load])

  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.code : 'internal_error')
  const person = (memberName: string) => space.members.find((m) => m.name === memberName)

  return (
    <Dialog title={t('members.title', { space: space.name })} onClose={onClose}>
      {problem && <p className="mb-3 text-sm text-bad-500">{errorText(problem)}</p>}
      <ul className="space-y-1">
        {listing?.members.map((m) => {
          const known = person(m.name)
          return (
            <li key={m.name} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar person={known ?? { id: 0, name: m.name, avatar: null }} className="h-8 w-8 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-mist-100">
                  {known?.display_name || m.name}
                  {m.you && <span className="ml-1.5 text-xs text-mist-600">({t('members.you')})</span>}
                </div>
                <div className="truncate text-xs text-mist-600">{m.name}</div>
              </div>
              <select
                disabled={!manage || m.you}
                value={m.role}
                onChange={async (e) => {
                  try {
                    await spacesApi.setMember(space.id, m.name, e.target.value as Role)
                    load()
                    void boards.refresh()
                  } catch (error) {
                    fail(error)
                  }
                }}
                className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-mist-300 disabled:opacity-60"
                aria-label={t('members.role')}
              >
                <option value="read">{t('roles.read')}</option>
                <option value="write">{t('roles.write')}</option>
                <option value="manage">{t('roles.manage')}</option>
              </select>
              {(manage || m.you) && (
                <button
                  type="button"
                  title={m.you ? t('members.leave') : t('members.remove')}
                  aria-label={m.you ? t('members.leave') : t('members.remove')}
                  className="rounded p-1 text-mist-600 hover:bg-ink-800 hover:text-bad-500"
                  onClick={async () => {
                    try {
                      await spacesApi.removeMember(space.id, m.name)
                      if (m.you) {
                        onClose()
                        void boards.refresh()
                      } else load()
                    } catch (error) {
                      fail(error)
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {manage && (
        <form
          className="mt-4 space-y-2 border-t border-ink-700/70 pt-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            setProblem(null)
            try {
              await spacesApi.setMember(space.id, name.trim().toLowerCase(), role)
              setSent(name.trim())
              setName('')
              load()
            } catch (error) {
              fail(error)
            }
          }}
        >
          <label className="text-xs font-medium text-mist-500" htmlFor="invite">
            {t('members.invite')}
          </label>
          <div className="flex gap-2">
            <input id="invite" className="nc-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('members.invitePlaceholder')} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-edge bg-ink-900 px-2 text-xs text-mist-300" aria-label={t('members.role')}>
              <option value="read">{t('roles.read')}</option>
              <option value="write">{t('roles.write')}</option>
              <option value="manage">{t('roles.manage')}</option>
            </select>
            <button type="submit" className="nc-btn nc-btn-accent shrink-0">
              <Send className="h-4 w-4" />
              {t('members.send')}
            </button>
          </div>
          {sent && <p className="text-xs text-ok-500">{t('members.sent', { name: sent })}</p>}
          {link ? (
            <div className="flex gap-2 pt-1">
              <input readOnly value={link} className="nc-field font-mono text-xs" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="nc-btn nc-btn-ghost shrink-0"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).catch(() => undefined)
                  setCopied(true)
                }}
              >
                {copied ? <Check className="h-4 w-4 text-ok-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex items-center gap-2 pt-1 text-xs text-accent-400 hover:underline"
              onClick={async () => {
                try {
                  const made = await spacesApi.invite(space.id, role)
                  setLink(made.link)
                  load()
                } catch (error) {
                  fail(error)
                }
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
              {t('members.link', { role: t(`roles.${role}`) })}
            </button>
          )}
          {listing && listing.invites.length > 0 && (
            <p className="pt-1 text-xs text-mist-600">{t('members.openInvites', { count: listing.invites.length })}</p>
          )}
        </form>
      )}
      {!listing && !problem && <p className="text-sm text-mist-600">{t('common.loading')}</p>}
      {me && listing && !manage && <p className="mt-3 text-xs text-mist-600">{t('members.onlyManagers')}</p>}
    </Dialog>
  )
}


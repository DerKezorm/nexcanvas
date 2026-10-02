import { Link2, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ME, PEOPLE, type Space } from '../board/demo'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'

type Role = 'manage' | 'write' | 'read'

/**
 * Members of a space and their roles, as in nexlore: read, write, manage. Adding someone by name sends an
 * invitation they accept or decline; a link works for people without an account. Nothing is saved in the mock.
 */
export function MembersDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState(space.members)
  const [name, setName] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const manage = space.role === 'manage'
  return (
    <Dialog title={t('members.title', { space: space.name })} onClose={onClose}>
      <ul className="space-y-1">
        {members.map((m) => {
          const p = PEOPLE.find((x) => x.id === m.person)
          return (
            <li key={m.person} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar person={m.person} className="h-8 w-8 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-mist-100">
                  {p?.name}
                  {m.person === ME && <span className="ml-1.5 text-xs text-mist-600">({t('members.you')})</span>}
                </div>
                <div className="truncate text-xs text-mist-600">{p?.email}</div>
              </div>
              <select
                disabled={!manage || m.person === ME}
                value={m.role}
                onChange={(e) => setMembers((list) => list.map((x) => (x.person === m.person ? { ...x, role: e.target.value as Role } : x)))}
                className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-mist-300 disabled:opacity-60"
                aria-label={t('members.role')}
              >
                <option value="read">{t('members.read')}</option>
                <option value="write">{t('members.write')}</option>
                <option value="manage">{t('members.manage')}</option>
              </select>
            </li>
          )
        })}
      </ul>
      {manage && (
        <form
          className="mt-4 space-y-2 border-t border-ink-700/70 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            setSent(name.trim())
            setName('')
          }}
        >
          <label className="text-xs font-medium text-mist-500" htmlFor="invite">
            {t('members.invite')}
          </label>
          <div className="flex gap-2">
            <input id="invite" className="nc-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('members.invitePlaceholder')} />
            <button type="submit" className="nc-btn nc-btn-accent shrink-0">
              <Send className="h-4 w-4" />
              {t('members.send')}
            </button>
          </div>
          {sent && <p className="text-xs text-ok-500">{t('members.sent', { name: sent })}</p>}
          <button type="button" className="flex items-center gap-2 pt-1 text-xs text-accent-400 hover:underline">
            <Link2 className="h-3.5 w-3.5" />
            {t('members.link')}
          </button>
        </form>
      )}
    </Dialog>
  )
}

import { Link2, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError, spacesApi, type Invite, type Role } from '../api/client'
import type { Space } from '../board/store'
import { useBoards } from '../board/store'
import { errorText } from '../lib/errors'
import { Button, CopyLink, Input, Select } from '../pages/settings/ui'
import { useAuth } from '../state/auth'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'

type Listing = Awaited<ReturnType<typeof spacesApi.members>>
type NewInvite = Invite & { link: string; sent: boolean }

const ROLES: Role[] = ['read', 'write', 'manage']
const DAYS = ['1', '7', '30'] as const

/**
 * Who is in a space and with which right, and invitations into it, as nexlore's: a manager changes everything here;
 * the operator opens it to reset rights of a space it does not read (then without inviting). Naming an account sends
 * an invitation it accepts or declines (the answer is the same whether the name exists or not); a link brings in
 * people without an account.
 */
export function MembersDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { me } = useAuth()
  const boards = useBoards()
  const [data, setData] = useState<Listing | null>(null)
  const [person, setPerson] = useState('')
  const [personRole, setPersonRole] = useState<Role>('read')
  const [inviteRole, setInviteRole] = useState<Role>('write')
  const [days, setDays] = useState<(typeof DAYS)[number]>('7')
  const [email, setEmail] = useState('')
  const [send, setSend] = useState(false)
  const [made, setMade] = useState<NewInvite | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Giving up the last right to manage, asked once more: after it only the operator can manage the space. */
  const [lastManager, setLastManager] = useState<{ role: Role | null } | null>(null)
  const [invitedName, setInvitedName] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'internal_error')
    } finally {
      setBusy(false)
    }
  }, [])
  const load = useCallback(() => run(async () => setData(await spacesApi.members(space.id))), [run, space.id])
  useEffect(() => {
    void load()
  }, [load])

  const manages = data?.role === 'manage'
  /** A space nexsuite gives this app: its rights are kept there, here they are only shown. */
  const locked = Boolean(data?.managed)
  const managers = data?.members.filter((member) => member.role === 'manage').length ?? 0
  const known = (name: string) => space.members.find((m) => m.name === name)

  /** The own right changes (`role`) or the own membership ends (`null`). */
  const changeOwn = (role: Role | null, asked = false) => {
    if (!asked && managers === 1 && role !== 'manage') {
      setLastManager({ role })
      return
    }
    setLastManager(null)
    void run(async () => {
      if (role === null) await spacesApi.removeMember(space.id, me?.name ?? '')
      else await spacesApi.setMember(space.id, me?.name ?? '', role)
      // Without the right to manage the list is not readable any more: close instead of showing an error.
      if (role === null || (role !== 'manage' && me?.role !== 'operator')) {
        await boards.refresh()
        onClose()
      } else await load()
    })
  }
  const roleOptions = ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))

  return (
    <Dialog title={t('members.title', { space: space.name })} onClose={onClose} medium>
      {locked && (
        <p className="-mt-2 mb-3 flex items-center gap-2 rounded-xl border border-accent-500/30 bg-accent-500/8 px-3 py-2 text-xs text-mist-200" data-testid="space-managed">
          <Lock className="h-3.5 w-3.5 shrink-0 text-accent-400" aria-hidden /> {t('suite.managedSpace')}
        </p>
      )}
      {!locked && !manages && data && <p className="-mt-2 mb-3 text-xs text-mist-500">{t('members.resetOnly')}</p>}

      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
        {data?.members.map((member) => {
          const shown = known(member.name)
          return (
            <li key={member.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <Avatar person={shown ?? { id: 0, name: member.name, avatar: null }} className="h-7 w-7 text-xs" />
              <span className="min-w-0 flex-1 truncate font-medium text-mist-100">
                {shown?.display_name || member.name}
                {shown?.display_name && <span className="ml-1.5 text-xs font-normal text-mist-500">@{member.name}</span>}
                {member.you && <span className="ml-2 text-xs font-normal text-mist-500">{t('members.you')}</span>}
              </span>
              {locked ? (
                <span className="text-xs text-mist-400">{t(`roles.${member.role}`)}</span>
              ) : (
                <>
              <label className="sr-only" htmlFor={`role-${member.name}`}>
                {t('members.roleOf', { name: member.name })}
              </label>
              <select
                id={`role-${member.name}`}
                value={member.role}
                disabled={busy}
                onChange={(event) => {
                  const role = event.target.value as Role
                  if (member.you) return changeOwn(role)
                  void run(async () => {
                    await spacesApi.setMember(space.id, member.name, role)
                    await load()
                    void boards.refresh()
                  })
                }}
                className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-mist-200"
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                small
                danger
                busy={busy}
                label={member.you ? t('members.leave') : t('members.remove', { name: member.name })}
                onClick={() => {
                  if (member.you) return changeOwn(null)
                  void run(async () => {
                    await spacesApi.removeMember(space.id, member.name)
                    await load()
                  })
                }}
              >
                {member.you ? t('members.leave') : t('members.removeShort')}
              </Button>
                </>
              )}
            </li>
          )
        })}
        {data && data.members.length === 0 && <li className="px-4 py-3 text-sm text-mist-500">{t('members.none')}</li>}
      </ul>
      {lastManager && (
        <div role="alert" className="mt-3 rounded-xl border border-warn-500/30 bg-warn-500/10 px-4 py-3 text-sm text-mist-100">
          <p>{lastManager.role === null ? t('members.lastManagerLeave') : t('members.lastManagerRole')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button small danger busy={busy} onClick={() => changeOwn(lastManager.role, true)}>
              {lastManager.role === null ? t('members.leaveAnyway') : t('members.changeAnyway')}
            </Button>
            <Button small onClick={() => setLastManager(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {!locked && (
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!person.trim()) return
          const name = person.trim().toLowerCase()
          setInvitedName(null)
          void run(async () => {
            const answer = await spacesApi.setMember(space.id, name, personRole)
            setPerson('')
            if (answer.invited) setInvitedName(name)
            await load()
          })
        }}
      >
        <Input label={t('members.addName')} value={person} onChange={setPerson} className="min-w-40 flex-1" />
        <Select label={t('members.role')} value={personRole} options={roleOptions} onChange={setPersonRole} />
        <Button type="submit" busy={busy}>
          {manages ? t('members.inviteName') : t('members.add')}
        </Button>
      </form>
      )}
      {invitedName && (
        <p role="status" className="mt-2 text-xs text-mist-400">
          {t('members.invitedName', { name: invitedName })}
        </p>
      )}

      {manages && !data?.suite && (
        <div className="mt-6 border-t border-ink-700 pt-4">
          <h3 className="text-sm font-semibold text-mist-100">{t('members.inviteLink.title')}</h3>
          <p className="mt-0.5 text-xs text-mist-500">{t('members.inviteLink.text')}</p>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                setMade(await api<NewInvite>(`/api/spaces/${space.id}/invites`, { method: 'POST', body: { role: inviteRole, days: Number(days), email: email.trim(), send } }))
                await load()
              })
            }}
          >
            <Select label={t('members.role')} value={inviteRole} options={roleOptions} onChange={setInviteRole} />
            <Select label={t('invite.valid')} value={days} options={DAYS.map((value) => ({ value, label: t('invite.days', { count: Number(value) }) }))} onChange={setDays} />
            <Input label={t('invite.email')} value={email} onChange={setEmail} type="email" hint={me?.mail ? undefined : t('invite.noMail')} />
            {me?.mail && (
              <label className="flex items-center gap-2 text-xs text-mist-400 sm:col-span-2">
                <input type="checkbox" checked={send} onChange={(event) => setSend(event.target.checked)} className="accent-accent-500" />
                {t('invite.send')}
              </label>
            )}
            <div className="sm:col-span-3">
              <Button type="submit" accent busy={busy}>
                <Link2 className="h-4 w-4" strokeWidth={1.8} /> {t('invite.create')}
              </Button>
            </div>
          </form>
          {made && (
            <div className="mt-3 space-y-1">
              <CopyLink value={made.link} label={t('invite.copy')} />
              <p className="text-xs text-mist-500">{made.sent ? t('invite.sent', { email: made.email }) : t('invite.once')}</p>
            </div>
          )}
          {data && data.invites.length > 0 && (
            <ul className="mt-4 divide-y divide-ink-700 rounded-xl border border-ink-700 text-xs" data-testid="space-invites">
              {data.invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-mist-300">
                  <span className="flex-1">
                    {t(`roles.${invite.role}`)}
                    {invite.email && ` · ${invite.email}`} · {t('invite.until', { when: new Date(invite.expires_at).toLocaleDateString(i18n.language) })}
                  </span>
                  <Button
                    small
                    danger
                    busy={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/api/invites/${invite.id}`, { method: 'DELETE' })
                        await load()
                      })
                    }
                  >
                    {t('invite.withdraw')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {problem && <p className="mt-3 text-sm text-bad-500">{errorText(problem)}</p>}
      {!data && !problem && <p className="text-sm text-mist-600">{t('common.loading')}</p>}
    </Dialog>
  )
}

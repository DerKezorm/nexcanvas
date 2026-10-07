/**
 * Teams: who works together, the same in every app of the family (nextasks has them too). The operator makes them;
 * the lead of a team changes its members when the operator allows it (off from the start, D3). A space gives a team a right, and then everybody in it has that right.
 * Everybody on the server sees everybody, as in nextasks.
 */
import { Mail, Plus, Trash2, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { api, authApi, directoryApi, spacesApi, type Directory, type Person, type Role, type Team } from '../api/client'
import { useBoards, type Space } from '../board/store'
import { Button, Card, Feedback, Toggle, useAction } from '../pages/settings/ui'
import { useAuth } from '../state/auth'
import { Managed } from './Suite'
import { Avatar, letterColors } from './Avatar'
import { Dialog } from './Dialog'
import { SPACE_COLORS } from './NewSpaceDialog'
import { COLOR_NAMES } from './NewSpaceDialog'

const ROLES: Role[] = ['read', 'write', 'manage']

/** People and teams from the server, loaded once per page and again after a change. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDirectory() {
  const [directory, setDirectory] = useState<Directory | null>(null)
  const reload = useCallback(async () => {
    setDirectory(await directoryApi.get())
  }, [])
  useEffect(() => {
    directoryApi.get().then(setDirectory, () => undefined)
  }, [])
  const person = (id: number): Person | undefined => directory?.people.find((p) => p.id === id)
  const team = (id: number): Team | undefined => directory?.teams.find((t) => t.id === id)
  return { directory, reload, person, team }
}

export function TeamBadge({ team, className = 'h-6 w-6 text-[11px]' }: { team: { name: string; color: string }; className?: string }) {
  return (
    <span
      title={team.name}
      className={'grid shrink-0 place-items-center rounded-md font-bold ' + className}
      style={letterColors(team.color)}
    >
      {team.name.trim()[0]?.toUpperCase()}
    </span>
  )
}

/** Settings, tab Teams. */
export function TeamsCard() {
  const { t } = useTranslation()
  const { me, setMe } = useAuth()
  const managed = me?.suite === 'connected'
  const operator = me?.role === 'operator' && !managed
  const { directory, reload, person } = useDirectory()
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const teams = directory?.teams ?? []
  // Whether leads change their teams: the operator's switch (D3). Connected, nexsuite decides.
  const [leadsEdit, setLeadsEdit] = useState<boolean | null>(null)
  const switching = useAction()
  useEffect(() => {
    if (operator) api<{ team_leads_edit: boolean }>('/api/settings').then((s) => setLeadsEdit(s.team_leads_edit), () => undefined)
  }, [operator])
  return (
    <Card icon={UsersRound} title={t('settings.tabs.teams')} text={t('teams.text')}>
      {managed && <Managed text={t('suite.managedTeams')} />}
      {operator && leadsEdit !== null && (
        <Toggle
          label={t('teams.leadsSwitch')}
          hint={t('teams.leadsSwitchHint')}
          checked={leadsEdit}
          disabled={switching.busy}
          onChange={(value) => {
            const before = leadsEdit
            setLeadsEdit(value)
            void switching
              .run(async () => {
                const saved = await api<{ team_leads_edit: boolean }>('/api/settings', { method: 'PUT', body: { team_leads_edit: value } })
                setLeadsEdit(saved.team_leads_edit)
                setMe(await authApi.me())
              })
              .then((ok) => {
                if (!ok) setLeadsEdit(before)
              })
          }}
        />
      )}
      {switching.problem && <Feedback problem={switching.problem} />}
      {directory && teams.length === 0 && <p className="text-sm text-mist-500">{t('teams.none')}</p>}
      {teams.map((team) => {
        const mayChange = !managed && (operator || (!!me?.may_edit_led_teams && team.lead === directory?.me && team.source === 'local'))
        const lead = team.lead ? person(team.lead) : undefined
        return (
          <div key={team.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
            <TeamBadge team={team} className="h-7 w-7 text-xs" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-mist-100">{team.name}</span>
              <span className="text-xs text-mist-500">
                {lead ? t('teams.lead', { name: lead.display_name }) : t('teams.noLead')} · {t('teams.size', { count: team.size })}
              </span>
            </span>
            <span className="flex -space-x-1.5">
              {team.members.slice(0, 8).map((id) => {
                const p = person(id)
                return p ? <Avatar key={id} person={p} className="h-6 w-6 text-[11px]" ring /> : null
              })}
            </span>
            {team.source === 'admin' && (
              <span className="rounded-full border border-accent-500/40 px-2 py-0.5 text-[11px] font-medium text-accent-400">{t('teams.fromAdmin')}</span>
            )}
            {mayChange && (
              <Button small onClick={() => setEditing(team)}>
                {t('teams.edit')}
              </Button>
            )}
          </div>
        )
      })}
      {operator && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> {t('teams.new')}
          </Button>
          <InviteButton />
        </div>
      )}
      {editing && directory && (
        <TeamDialog
          team={editing === 'new' ? null : editing}
          operator={operator}
          people={directory.people}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </Card>
  )
}

/** To the invitations (Settings, Server, Accounts), for the operator: who has no account cannot be in a team. */
function InviteButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Button onClick={() => navigate('/settings?tab=server&sub=accounts')}>
      <Mail className="h-4 w-4" /> {t('teams.invite')}
    </Button>
  )
}

function TeamDialog({ team, operator, people, onClose, onSaved }: { team: Team | null; operator: boolean; people: Person[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState(team?.name ?? '')
  const [color, setColor] = useState(team?.color ?? SPACE_COLORS[0])
  const [members, setMembers] = useState<number[]>(team?.members ?? [])
  const [lead, setLead] = useState<number | null>(team?.lead ?? null)
  const [confirming, setConfirming] = useState(false)
  const action = useAction()
  const label = 'text-xs font-medium text-mist-500'
  const save = () =>
    void action.run(async () => {
      if (team) await directoryApi.change(team.id, operator ? { name, color, members, lead } : { members })
      else await directoryApi.create({ name, color, members, lead })
      await onSaved()
      onClose()
    })
  const remove = () =>
    void action.run(async () => {
      if (!team) return
      await directoryApi.remove(team.id)
      await onSaved()
      onClose()
    })
  return (
    <Dialog title={team ? team.name : t('teams.new')} onClose={onClose} medium>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {operator && (
          <>
            <label className="block space-y-1.5">
              <span className={label}>{t('teams.name')}</span>
              <input className="nc-field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('teams.namePlaceholder')} />
            </label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('teams.color')}>
              {SPACE_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={t(`colorNames.${COLOR_NAMES[c] ?? 'grey'}`)} onClick={() => setColor(c)} className={'h-7 w-7 rounded-full ring-offset-2 ring-offset-ink-900 ' + (color === c ? 'ring-2 ring-accent-500' : '')} style={{ background: c }} />
              ))}
            </div>
          </>
        )}
        <fieldset className="space-y-1.5">
          <legend className={label}>{t('teams.members')}</legend>
          <div className="nc-scroll max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-ink-700 p-1">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-850">
                <input
                  type="checkbox"
                  checked={members.includes(p.id)}
                  onChange={(e) => {
                    setMembers((list) => (e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id)))
                    if (!e.target.checked && lead === p.id) setLead(null)
                  }}
                  className="h-4 w-4 accent-[var(--color-accent-500)]"
                />
                <Avatar person={p} className="h-6 w-6 text-[11px]" />
                <span className="flex-1 text-mist-100">{p.display_name}</span>
                {operator && members.includes(p.id) && (
                  <button type="button" aria-pressed={lead === p.id} onClick={() => setLead(lead === p.id ? null : p.id)} className={'rounded-full px-2 py-0.5 text-[11px] ' + (lead === p.id ? 'bg-accent-500/15 text-accent-400' : 'text-mist-600 hover:text-mist-100')}>
                    {t('teams.leadMark')}
                  </button>
                )}
              </label>
            ))}
          </div>
          {people.length <= 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-xs text-mist-500">{t('teams.nobodyElse')}</p>
              {operator && <InviteButton />}
            </div>
          )}
          {!operator && <p className="text-xs text-mist-500">{t('teams.leadHint')}</p>}
        </fieldset>
        <Feedback problem={action.problem} />
        <div className="flex items-center justify-between gap-2">
          {team && operator ? (
            confirming ? (
              <button type="button" className="nc-btn bg-bad-500 text-on-bad" onClick={remove}>
                <Trash2 className="h-4 w-4" /> {t('teams.deleteSure')}
              </button>
            ) : (
              <button type="button" className="nc-btn nc-btn-ghost text-bad-500" onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" /> {t('teams.delete')}
              </button>
            )
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="nc-btn nc-btn-ghost">
              {t('common.cancel')}
            </button>
            <button type="submit" className="nc-btn nc-btn-accent" disabled={!name.trim() || action.busy}>
              {team ? t('common.save') : t('teams.create')}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  )
}

/** Which team has which right in a space; only its managers change it. */
export function TeamRightsDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { t } = useTranslation()
  const boards = useBoards()
  const { directory } = useDirectory()
  const action = useAction()
  const current = boards.space(space.id) ?? space
  const manages = current.role === 'manage'
  const teams = directory?.teams ?? []
  const change = (team: Team, role: Role | null) =>
    void action.run(async () => {
      const answer = await spacesApi.teamRight(space.id, team.id, role)
      await boards.refresh()
      if ('gone' in answer) onClose()
    })
  return (
    <Dialog title={t('teams.rightsTitle', { space: current.name })} onClose={onClose} medium>
      <p className="mb-3 text-sm text-mist-500">{t('teams.rightsText')}</p>
      {directory && teams.length === 0 && <p className="text-sm text-mist-500">{t('teams.none')}</p>}
      <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
        {teams.map((team) => {
          const grant = current.teams.find((g) => g.id === team.id)
          return (
            <li key={team.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <TeamBadge team={team} className="h-6 w-6 text-[11px]" />
              <span className="min-w-0 flex-1 truncate text-mist-100">{team.name}</span>
              <span className="text-xs text-mist-500">{t('teams.size', { count: team.size })}</span>
              <select
                disabled={!manages || action.busy}
                value={grant?.role ?? ''}
                onChange={(e) => change(team, (e.target.value || null) as Role | null)}
                aria-label={t('teams.rightFor', { team: team.name })}
                className="rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-mist-100"
              >
                <option value="">{t('teams.noRight')}</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`roles.${role}`)}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
      <div className="mt-3">
        <Feedback problem={action.problem} />
      </div>
    </Dialog>
  )
}

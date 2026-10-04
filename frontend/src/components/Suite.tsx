/**
 * nexcanvas and nexsuite, as the operator sees it: connecting (address and one-time code, then matching accounts and
 * spaces), the state of the connection, disconnecting with the password or with an emergency code. And the line other
 * cards show where a setting is kept in nexsuite now.
 */
import { Box, KeyRound, Lock, Plug, RefreshCw, ShieldAlert, Unplug , Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import { Button, Card, Feedback, useAction } from '../pages/settings/ui'
import { useAuth } from '../state/auth'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'

type Status = { state: '' | 'connecting' | 'connected'; url: string; last_sync: string | null; problem: string; emergency_codes: number; mail: boolean }
type SuitePerson = { id: string; name: string; display_name: string; email: string }
type LocalAccount = { id: number; name: string; display_name: string; email: string; role: string; suggest: string }
type LocalSpace = { id: number; name: string; color: string; suggest: string }
type Proposal = {
  people: SuitePerson[]
  accounts: LocalAccount[]
  spaces: LocalSpace[]
  candidates: { id: string; name: string }[]
  teams: LocalSpace[]
  team_candidates: { id: string; name: string }[]
}

/** Every person, space or team in nexsuite gets at most one counterpart here: taken elsewhere, it is shown, not offered. */
function takenElsewhere(choices: Record<number, string>, own: number): Set<string> {
  return new Set(Object.entries(choices).filter(([id, value]) => Number(id) !== own && value !== 'new' && value !== 'skip').map(([, value]) => value))
}

/** The lock line: this is kept in nexsuite now. */
export function Managed({ text }: { text?: string }) {
  const { t } = useTranslation()
  return (
    <p className="flex items-center gap-2 rounded-xl border border-accent-500/30 bg-accent-500/8 px-3 py-2 text-xs text-mist-300">
      <Lock className="h-3.5 w-3.5 shrink-0 text-accent-400" aria-hidden />
      {text ?? t('suite.managed')}
    </p>
  )
}

/** A card in place of one whose settings nexsuite keeps now. */
export function ManagedCard({ title, text }: { title: string; text: string }) {
  return (
    <Card icon={Lock} title={title}>
      <Managed text={text} />
    </Card>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSuiteConnected(): boolean {
  const { me } = useAuth()
  return me?.suite === 'connected'
}

/** Settings, Server, nexsuite. */
export function SuiteCard() {
  const { t } = useTranslation()
  const { me, setMe } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [wizard, setWizard] = useState(false)
  const [leaving, setLeaving] = useState<'password' | 'code' | null>(null)
  const [without, setWithout] = useState<string[] | null>(null)
  const [stillBlocked, setStillBlocked] = useState<string[]>([])
  const action = useAction()
  const load = useCallback(async () => {
    setStatus(await api<Status>('/api/suite'))
    setMe(await api('/api/auth/me'))
  }, [setMe])
  useEffect(() => {
    api<Status>('/api/suite').then(setStatus, () => undefined)
  }, [])
  if (!status) return null
  const connected = status.state === 'connected'
  return (
    <>
      <Card icon={Plug} title="nexsuite" text={connected ? t('suite.connectedText', { url: status.url }) : t('suite.aloneText')}>
        {!connected && (
          <>
            <ul className="list-disc space-y-1 pl-5 text-sm text-mist-300">
              <li>{t('suite.point1')}</li>
              <li>{t('suite.point2')}</li>
              <li>{t('suite.point3')}</li>
            </ul>
            <Button accent onClick={() => setWizard(true)}>
              <Plug className="h-4 w-4" /> {status.state === 'connecting' ? t('suite.resume') : t('suite.connect')}
            </Button>
          </>
        )}
        {connected && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-mist-500">{t('suite.address')}</dt>
              <dd className="font-mono text-mist-100">{status.url}</dd>
              <dt className="text-mist-500">{t('suite.lastSync')}</dt>
              <dd className="text-mist-100">{status.last_sync ? new Date(status.last_sync).toLocaleString() : t('suite.never')}</dd>
              <dt className="text-mist-500">{t('suite.emergencyCodes')}</dt>
              <dd className="text-mist-100">{status.emergency_codes ? t('suite.codesKnown', { count: status.emergency_codes }) : t('suite.codesNone')}</dd>
            </dl>
            {status.problem && <p className="text-sm text-warn-500">{t(`errors.${status.problem}`, { defaultValue: status.problem })}</p>}
            <div className="flex flex-wrap gap-2">
              <Button busy={action.busy} onClick={() => void action.run(async () => { await api('/api/suite/sync', { method: 'POST' }); await load() })}>
                <RefreshCw className="h-4 w-4" /> {t('suite.syncNow')}
              </Button>
              <a href={status.url} target="_blank" rel="noreferrer" className="nc-btn nc-btn-ghost">
                {t('suite.open')}
              </a>
              {/* Disconnecting here is the emergency account's; whoever comes through nexsuite does it there. */}
              {me?.suite_emergency && (
                <>
                  <Button danger onClick={() => setLeaving('password')}>
                    <Unplug className="h-4 w-4" /> {t('suite.disconnect')}
                  </Button>
                  <Button danger onClick={() => setLeaving('code')}>
                    <ShieldAlert className="h-4 w-4" /> {t('suite.withCode')}
                  </Button>
                </>
              )}
            </div>
            {!me?.suite_emergency && <p className="text-xs text-mist-500">{t('suite.disconnectInSuite')}</p>}
            <Feedback problem={action.problem} />
          </>
        )}
        {without && without.length > 0 && <p className="text-sm text-warn-500">{t('suite.withoutPassword', { names: without.join(', ') })}</p>}
        {stillBlocked.length > 0 && <p className="text-sm text-warn-500">{t('suite.stillBlocked', { names: stillBlocked.join(', ') })}</p>}
      </Card>
      {connected && (
        <Card icon={KeyRound} title={t('suite.emergencyTitle')} text={t('suite.emergencyText')}>
          <p className="text-sm text-mist-300">{t('suite.emergencyHow')}</p>
        </Card>
      )}
      {wizard && (
        <ConnectWizard
          resume={status.state === 'connecting'}
          onClose={() => {
            setWizard(false)
            void load()
          }}
        />
      )}
      {leaving && (
        <LeaveDialog
          mode={leaving}
          onClose={() => setLeaving(null)}
          onDone={(names, blocked) => {
            setLeaving(null)
            setWithout(names)
            setStillBlocked(blocked)
            void load()
          }}
        />
      )}
    </>
  )
}

function LeaveDialog({ mode, onClose, onDone }: { mode: 'password' | 'code'; onClose: () => void; onDone: (without: string[], blocked: string[]) => void }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const action = useAction()
  const go = () =>
    void action.run(async () => {
      const path = mode === 'code' ? '/api/suite/emergency' : '/api/suite/disconnect'
      const answer = await api<{ without_password: string[]; blocked?: string[] }>(path, { method: 'POST', body: mode === 'code' ? { current_password: password, code } : { current_password: password } })
      onDone(answer.without_password, answer.blocked ?? [])
    })
  return (
    <Dialog title={mode === 'code' ? t('suite.withCode') : t('suite.disconnectTitle')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mist-300">
          <li>{t('suite.leave1')}</li>
          <li>{t('suite.leave2')}</li>
          <li>{mode === 'code' ? t('suite.leaveCode') : t('suite.leave3')}</li>
        </ul>
        {mode === 'code' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-mist-500">{t('suite.code')}</span>
            <input className="nc-field font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" />
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mist-500">{t('suite.ownPassword')}</span>
          <input className="nc-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <Feedback problem={action.problem} />
        <div className="flex justify-end gap-2">
          <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="nc-btn bg-bad-500 text-white" disabled={!password || (mode === 'code' && !code.trim()) || action.busy}>
            <Unplug className="h-4 w-4" /> {t('suite.disconnect')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function ConnectWizard({ resume, onClose }: { resume: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [step, setStep] = useState(resume ? 2 : 1)
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [accounts, setAccounts] = useState<Record<number, string>>({})
  const [spaces, setSpaces] = useState<Record<number, string>>({})
  const [teams, setTeams] = useState<Record<number, string>>({})
  const [fresh, setFresh] = useState<{ name: string; password: string }[]>([])
  const action = useAction()
  const take = (found: Proposal) => {
    setProposal(found)
    setAccounts(Object.fromEntries(found.accounts.map((a) => [a.id, a.suggest])))
    setSpaces(Object.fromEntries(found.spaces.map((s) => [s.id, s.suggest])))
    setTeams(Object.fromEntries((found.teams ?? []).map((team) => [team.id, team.suggest])))
  }
  useEffect(() => {
    if (resume) api<Proposal>('/api/suite/proposal').then(take, () => setStep(1))
  }, [resume])
  const titles = ['', t('suite.step1'), t('suite.step2'), t('suite.step3'), t('suite.step4')]
  const pair = () =>
    void action.run(async () => {
      take(await api<Proposal>('/api/suite/start', { method: 'POST', body: { url: url.trim(), code: code.trim() } }))
      setStep(2)
    })
  const finish = () =>
    void action.run(async () => {
      const answer = await api<{ new_people?: { name: string; password: string }[] }>('/api/suite/finish', { method: 'POST', body: { accounts, spaces, teams } })
      setFresh(answer.new_people ?? [])
      setStep(4)
    })
  const abort = () =>
    void action.run(async () => {
      await api('/api/suite/abort', { method: 'POST' })
      onClose()
    })
  const own = me ? accounts[me.id] : undefined
  return (
    <Dialog title={t('suite.wizardTitle', { step, title: titles[step] })} onClose={onClose} wide>
      {step === 1 && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            pair()
          }}
        >
          <p className="text-sm text-mist-300">{t('suite.step1Text')}</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-mist-500">{t('suite.address')}</span>
            <input className="nc-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://suite.example.com" autoFocus />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-mist-500">{t('suite.code')}</span>
            <input className="nc-field font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" />
          </label>
          <Feedback problem={action.problem} />
          <div className="flex justify-end gap-2">
            <button type="button" className="nc-btn nc-btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="nc-btn nc-btn-accent" disabled={!url.trim() || code.trim().length < 4 || action.busy}>
              {t('suite.next')}
            </button>
          </div>
        </form>
      )}
      {step === 2 && proposal && (
        <div className="space-y-3">
          <p className="text-sm text-mist-300">{t('suite.step2Text')}</p>
          <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
            {proposal.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Avatar person={{ id: a.id, name: a.name, display_name: a.display_name, avatar: null }} className="h-7 w-7 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-mist-100">{a.display_name || a.name}</span>
                  <span className="text-xs text-mist-500">{a.email || a.name}</span>
                </span>
                <span className="text-mist-600" aria-hidden>
                  →
                </span>
                <select
                  value={accounts[a.id] ?? 'new'}
                  onChange={(e) => setAccounts((m) => ({ ...m, [a.id]: e.target.value }))}
                  className="max-w-56 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-mist-100"
                  aria-label={t('suite.matchFor', { name: a.name })}
                >
                  <option value="new">{t('suite.newPerson')}</option>
                  {a.id !== me?.id && <option value="skip">{t('suite.skip')}</option>}
                  {proposal.people.map((p) => (
                    <option key={p.id} value={p.id} disabled={takenElsewhere(accounts, a.id).has(p.id)}>
                      {p.display_name || p.name}
                      {takenElsewhere(accounts, a.id).has(p.id) ? ` (${t('suite.takenElsewhere')})` : p.id === a.suggest ? ` (${t('suite.suggested')})` : ''}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <p className="text-xs text-mist-500">{t('suite.newPersonHint')}</p>
          {own === 'skip' && <p className="text-sm text-bad-500">{t('errors.operator_unmatched')}</p>}
          <div className="flex justify-between gap-2">
            <button type="button" className="nc-btn nc-btn-ghost text-bad-500" onClick={abort}>
              {t('suite.abort')}
            </button>
            <button type="button" className="nc-btn nc-btn-accent" onClick={() => setStep(3)}>
              {t('suite.next')}
            </button>
          </div>
        </div>
      )}
      {step === 3 && proposal && (
        <div className="space-y-3">
          <p className="text-sm text-mist-300">{t('suite.step3Text')}</p>
          <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
            {proposal.spaces.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Box className="h-4 w-4 shrink-0" style={{ color: s.color }} aria-hidden />
                <span className="min-w-0 flex-1 font-medium text-mist-100">{s.name}</span>
                <span className="text-mist-600" aria-hidden>
                  →
                </span>
                <select
                  value={spaces[s.id] ?? 'new'}
                  onChange={(e) => setSpaces((m) => ({ ...m, [s.id]: e.target.value }))}
                  className="max-w-56 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-mist-100"
                  aria-label={t('suite.matchFor', { name: s.name })}
                >
                  <option value="new">{t('suite.newSpace')}</option>
                  {proposal.candidates.map((c) => (
                    <option key={c.id} value={c.id} disabled={takenElsewhere(spaces, s.id).has(c.id)}>
                      {c.name}
                      {takenElsewhere(spaces, s.id).has(c.id) ? ` (${t('suite.takenElsewhere')})` : c.id === s.suggest ? ` (${t('suite.suggested')})` : ''}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {(proposal.teams ?? []).length > 0 && (
            <>
              <p className="text-sm text-mist-300">{t('suite.teamsText')}</p>
              <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
                {proposal.teams.map((team) => (
                  <li key={team.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <Users className="h-4 w-4 shrink-0" style={{ color: team.color }} aria-hidden />
                    <span className="min-w-0 flex-1 font-medium text-mist-100">{team.name}</span>
                    <span className="text-mist-600" aria-hidden>
                      →
                    </span>
                    <select
                      value={teams[team.id] ?? 'new'}
                      onChange={(e) => setTeams((m) => ({ ...m, [team.id]: e.target.value }))}
                      className="max-w-56 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-mist-100"
                      aria-label={t('suite.matchFor', { name: team.name })}
                    >
                      <option value="new">{t('suite.newTeam')}</option>
                      {proposal.team_candidates.map((c) => (
                        <option key={c.id} value={c.id} disabled={takenElsewhere(teams, team.id).has(c.id)}>
                          {c.name}
                          {takenElsewhere(teams, team.id).has(c.id) ? ` (${t('suite.takenElsewhere')})` : c.id === team.suggest ? ` (${t('suite.suggested')})` : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Feedback problem={action.problem} />
          <div className="flex justify-between gap-2">
            <button type="button" className="nc-btn nc-btn-ghost" onClick={() => setStep(2)}>
              {t('suite.back')}
            </button>
            <button type="button" className="nc-btn nc-btn-accent" disabled={action.busy || own === 'skip'} onClick={finish}>
              <Plug className="h-4 w-4" /> {t('suite.finish')}
            </button>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-3">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-mist-300">
            <li>{t('suite.done1')}</li>
            <li>{t('suite.done2')}</li>
            <li>{t('suite.done3')}</li>
          </ul>
          {fresh.some((p) => p.password === 'mailed') && (
            <p className="text-sm text-mist-300">{t('suite.freshMailed', { names: fresh.filter((p) => p.password === 'mailed').map((p) => p.name).join(', ') })}</p>
          )}
          {fresh.some((p) => p.password !== 'mailed') && (
            <p className="text-sm text-warn-500">{t('suite.freshInSuite', { names: fresh.filter((p) => p.password !== 'mailed').map((p) => p.name).join(', ') })}</p>
          )}
          <div className="flex justify-end">
            <button type="button" className="nc-btn nc-btn-accent" onClick={onClose}>
              {t('common.done')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

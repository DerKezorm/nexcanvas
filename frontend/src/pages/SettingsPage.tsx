/**
 * Settings, laid out like nexlore's: whoever knows one finds their way in the other.
 * Settings: General, Look, Spaces, Teams, and for the operator Server, with a second row for its parts. The tab is in the
 * address (`?tab=server&sub=backups`), so a link can point at one; a tab someone may not see falls back to General.
 * The own account is `AccountPage.tsx`.
 */
import {
  Box,
  Download,
  Eye,
  Files,
  Globe,
  History,
  House,
  Info,
  KeyRound,
  MousePointer2,
  Palette,
  Plug,
  RotateCcw,
  Shapes,
  Shield,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { api, authApi, type Me, type Preferences } from '../api/client'
import { useBoards, type Space } from '../board/store'
import { Avatar } from '../components/Avatar'
import { Dialog } from '../components/Dialog'
import { MembersDialog } from '../components/MembersDialog'
import { PackageList } from '../components/ShapePackages'
import { SuiteCard, useSuiteConnected } from '../components/Suite'
import { TeamBadge, TeamRightsDialog, TeamsCard } from '../components/Teams'
import { changeLanguage, languageOptions, templateFile, type LanguageOption } from '../i18n'
import { applyMode, storedMode, type Mode } from '../lib/theme'
import { useAuth } from '../state/auth'
import { AccountsCard, AllSpacesCard, ApiTokensCard, BackupsCard, FilesCard, LanguagesCard, LogCard, MailCard, ProxyHint, SharesCard, useServerSettings } from './settings/ServerCards'
import { SignInPart } from './settings/SignInCards'
import { Button, Card, Feedback, saveAsFile, TabRow, Toggle, useAction, type Tab } from './settings/ui'
import { useTitle } from '../lib/title'

type Top = 'general' | 'looks' | 'spaces' | 'teams' | 'server'
type Part = 'accounts' | 'signin' | 'suite' | 'shares' | 'api' | 'files' | 'shapes' | 'backups' | 'languages' | 'log'
const TOPS: Top[] = ['general', 'looks', 'spaces', 'teams', 'server']
const PARTS: Part[] = ['accounts', 'signin', 'suite', 'shares', 'api', 'files', 'shapes', 'backups', 'languages', 'log']
const TOP_ICON = { general: Globe, looks: Eye, spaces: Box, teams: UsersRound, server: ShieldCheck }
const PART_ICON = { accounts: Users, signin: KeyRound, suite: Shield, shares: Globe, api: Plug, files: Files, shapes: Shapes, backups: History, languages: Globe, log: Info }

export function SettingsPage() {
  const { t } = useTranslation()
  useTitle(t('settings.title'))
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const operator = me?.role === 'operator'
  const asked = params.get('tab') as Top | null
  const top: Top = asked && TOPS.includes(asked) && (asked !== 'server' || operator) ? asked : 'general'
  const askedPart = params.get('sub') as Part | null
  const part: Part = askedPart && PARTS.includes(askedPart) ? askedPart : 'accounts'
  const go = (next: Top, sub?: Part) => setParams(next === 'general' ? {} : sub ? { tab: next, sub } : { tab: next }, { replace: true })

  const tops: Tab<Top>[] = TOPS.filter((value) => value !== 'server' || operator).map((value) => ({ value, label: t(`settings.tabs.${value}`), icon: TOP_ICON[value] }))
  const parts: Tab<Part>[] = PARTS.map((value) => ({ value, label: t(`settings.parts.${value}`), icon: PART_ICON[value] }))

  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('settings.title')}</h1>
        <TabRow tabs={tops} active={top} onChange={(value) => go(value)} label={t('settings.title')} />
        {top === 'server' && <TabRow under tabs={parts} active={part} onChange={(value) => go('server', value)} label={t('settings.tabs.server')} />}
        <div className="space-y-6 pt-1">
          {top === 'general' && <General />}
          {top === 'looks' && <Looks />}
          {top === 'spaces' && <Spaces />}
          {top === 'teams' && <TeamsCard />}
          {top === 'server' && <ProxyHint />}
          {top === 'server' && <ServerPart part={part} />}
        </div>
      </div>
    </main>
  )
}

/** One part of the server, for the operator. */
function ServerPart({ part }: { part: Part }) {
  const { t } = useTranslation()
  const server = useServerSettings()
  const connected = useSuiteConnected()
  const { me } = useAuth()
  switch (part) {
    case 'accounts':
      return (
        <>
          <AccountsCard readOnly={connected} />
          <AllSpacesCard />
          <MailCard server={server} readOnly={!!me?.suite_mail} />
        </>
      )
    case 'signin':
      // Coupled too: the list stays visible (the own entries set aside, "off"), the authentik card locked (blueprint 06).
      return <SignInPart server={server} connected={connected} />
    case 'suite':
      return <SuiteCard />
    case 'shares':
      return <SharesCard server={server} />
    case 'api':
      return <ApiTokensCard server={server} />
    case 'files':
      return <FilesCard server={server} />
    case 'shapes':
      return (
        <Card id="shape-packages" icon={Shapes} title={t('packages.serverTitle')} text={t('packages.serverText')}>
          <PackageList space={null} canChange />
        </Card>
      )
    case 'backups':
      return <BackupsCard server={server} />
    case 'languages':
      return <LanguagesCard />
    case 'log':
      return <LogCard />
  }
}

function usePreferences() {
  const { me, setMe } = useAuth()
  const action = useAction()
  const change = (patch: Partial<Preferences>) =>
    void action.run(async () => {
      const next = await authApi.preferences(patch)
      if (me) setMe({ ...me, preferences: next } as Me)
    })
  return { preferences: me?.preferences, change, action }
}

function General() {
  const { t } = useTranslation()
  const { preferences, change, action } = usePreferences()
  if (!preferences) return null
  return (
    <>
      <LanguageCard />
      <Card icon={House} title={t('settings.start.title')} text={t('settings.start.text')}>
        {/* One row per choice, as nexlore's start page. */}
        <div className="grid gap-2" role="radiogroup" aria-label={t('settings.startPage')}>
          {(
            [
              ['boards', t('boards.all')],
              ['last', t('settings.lastBoard')],
            ] as const
          ).map(([start, label]) => (
            <label key={start} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-mist-100">
              <input type="radio" name="start" checked={preferences.start === start} onChange={() => change({ start })} className="accent-accent-500" />
              <span className="flex-1">{label}</span>
            </label>
          ))}
        </div>
        <Feedback problem={action.problem} />
      </Card>
      <Card icon={MousePointer2} title={t('settings.board.title')} text={t('settings.board.text')}>
        <Toggle label={t('settings.snap')} hint={t('settings.snapHint')} checked={preferences.snap} onChange={(snap) => change({ snap })} />
        <Toggle label={t('settings.toolBack')} hint={t('settings.toolBackHint')} checked={preferences.tool_back} onChange={(tool_back) => change({ tool_back })} />
        <Feedback problem={action.problem} />
      </Card>
    </>
  )
}

function LanguageCard() {
  const { t, i18n } = useTranslation()
  const { me, setMe } = useAuth()
  const operator = me?.role === 'operator'
  const [options, setOptions] = useState<LanguageOption[]>([])
  useEffect(() => {
    let alive = true
    void languageOptions().then((list) => alive && setOptions(list))
    return () => {
      alive = false
    }
  }, [])
  return (
    <Card icon={Globe} title={t('settings.language.title')} text={operator ? t('settings.language.text') : t('settings.language.textMember')}>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm">
        <label htmlFor="language" className="font-medium text-mist-100">
          {t('settings.language.choose')}
        </label>
        <select
          id="language"
          value={i18n.language}
          onChange={(e) => {
            const code = e.target.value
            void changeLanguage(code)
            // Kept with the account, so the next browser speaks it too.
            void authApi.language(code).then(setMe, () => undefined)
          }}
          className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-100"
        >
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
              {option.added ? ` (${t('settings.language.added')})` : ''}
            </option>
          ))}
        </select>
        {operator && (
          <button
            type="button"
            onClick={() => saveAsFile('nexcanvas-language-template.json', templateFile())}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-ink-700 px-3.5 py-1.5 text-sm text-mist-300 hover:bg-ink-800"
            title={t('settings.language.templateHint')}
          >
            <Download className="h-4 w-4" strokeWidth={1.8} /> {t('settings.language.template')}
          </button>
        )}
      </div>
      {operator && <p className="text-xs text-mist-500">{t('settings.language.templateHint')}</p>}
    </Card>
  )
}

/** Light or dark (kept in this browser, as the switch in the header), and how the board looks. */
function Looks() {
  const { t } = useTranslation()
  const { preferences, change, action } = usePreferences()
  const [mode, setMode] = useState<Mode>(storedMode())
  if (!preferences) return null
  return (
    <>
      <Card icon={Palette} title={t('settings.looks.title')} text={t('settings.looks.text')}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('theme.group')}>
          {(['dark', 'light', 'system'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                applyMode(value)
                setMode(value)
              }}
              className={
                'rounded-full border px-4 py-2 text-sm font-medium ' +
                (mode === value ? 'border-accent-500/60 bg-accent-500/15 text-accent-400' : 'border-ink-700 bg-ink-900 text-mist-500 hover:text-mist-100')
              }
            >
              {t(`theme.${value}`)}
            </button>
          ))}
        </div>
      </Card>
      <Card icon={Eye} title={t('settings.looks.board')} text={t('settings.looks.boardText')}>
        <Toggle label={t('settings.grid')} hint={t('settings.gridHint')} checked={preferences.dots} onChange={(dots) => change({ dots })} />
        <Feedback problem={action.problem} />
      </Card>
    </>
  )
}

function Spaces() {
  const { t } = useTranslation()
  const boards = useBoards()
  const [members, setMembers] = useState<Space | null>(null)
  const [teamsOf, setTeamsOf] = useState<Space | null>(null)
  const [params, setParams] = useSearchParams()
  const asked = Number(params.get('packages')) || null
  const packagesOf = boards.spaces.find((s) => s.id === asked) ?? null
  const [bin, setBin] = useState<{ id: number; name: string; color: string; deleted_at: string; in_suite?: boolean }[]>([])
  const action = useAction()
  useEffect(() => {
    api<{ id: number; name: string; color: string; deleted_at: string; in_suite?: boolean }[]>('/api/spaces/bin').then(setBin, () => undefined)
  }, [])
  return (
    <>
      <Card icon={Box} title={t('settings.spacesMine')} text={t('settings.spacesHint')}>
        <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
          {boards.spaces.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 basis-40 truncate font-medium text-mist-100">{s.name}</span>
              <span className="text-xs text-mist-500">
                {t(`roles.${s.role}`)} · {t('boards.count', { count: s.boards })}
              </span>
              <span className="hidden -space-x-1.5 sm:flex">
                {s.members.slice(0, 5).map((m) => (
                  <Avatar key={m.id} person={m} className="h-6 w-6 text-[11px]" ring />
                ))}
                {s.teams.map((grant) => (
                  <TeamBadge key={`t${grant.id}`} team={grant} className="h-6 w-6 text-[11px] ring-2 ring-ink-950" />
                ))}
              </span>
              {s.role === 'manage' && (
                <Button small onClick={() => setParams({ tab: 'spaces', packages: String(s.id) }, { replace: true })}>
                  <Shapes className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('packages.title')}
                </Button>
              )}
              {s.dropped ? (
                <span className="rounded-full border border-warn-500/40 px-2 py-0.5 text-[11px] font-medium text-warn-500" title={t('suite.droppedHint')} data-testid="space-dropped">
                  {t('suite.dropped')}
                </span>
              ) : s.managed ? (
                <span className="rounded-full border border-accent-500/40 px-2 py-0.5 text-[11px] font-medium text-accent-400">{t('suite.fromSuite')}</span>
              ) : (
                <>
                  <Button small onClick={() => setMembers(s)}>
                    <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('share.manage')}
                  </Button>
                  <Button small onClick={() => setTeamsOf(s)}>
                    <UsersRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('settings.tabs.teams')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {bin.length > 0 && (
        <Card icon={RotateCcw} title={t('settings.spacesBin')} text={t('settings.spacesBinHint')}>
          <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700">
            {bin.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-mist-200">{s.name}</span>
                {/* Deleted in nexsuite: it comes back there, and with it here (E1). */}
                {s.in_suite ? (
                  <span className="text-xs text-mist-500">{t('settings.spacesBinInSuite')}</span>
                ) : (
                  <Button
                    small
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api(`/api/spaces/${s.id}/restore`, { method: 'POST' })
                        setBin((list) => list.filter((x) => x.id !== s.id))
                        await boards.refresh()
                      })
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('files.restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Feedback problem={action.problem} />
        </Card>
      )}
      {members && <MembersDialog space={members} onClose={() => setMembers(null)} />}
      {teamsOf && <TeamRightsDialog space={teamsOf} onClose={() => setTeamsOf(null)} />}
      {packagesOf && (
        <Dialog title={t('packages.spaceTitle', { space: packagesOf.name })} onClose={() => setParams({ tab: 'spaces' }, { replace: true })} wide>
          <p className="mb-3 text-sm text-mist-500">{t('packages.spaceText')}</p>
          <PackageList space={packagesOf.id} canChange={packagesOf.role === 'manage'} />
        </Dialog>
      )}
    </>
  )
}

import { Download, KeyRound, ShieldCheck, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { ME, PEOPLE } from '../board/demo'
import { useBoards } from '../board/store'
import { Avatar } from '../components/Avatar'

/**
 * Settings and account, laid out like nexlore's, so whoever knows one finds their way in the other.
 * In the mock the cards only show what will be there; nothing is saved.
 */

function TabRow({ tabs, value, onChange, small = false }: { tabs: [string, string][]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div className={'flex gap-1 overflow-x-auto ' + (small ? '' : 'border-b border-ink-700/80')} role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={
            small
              ? 'shrink-0 rounded-full px-3 py-1 text-xs font-medium ' + (value === id ? 'bg-accent-500/15 text-accent-400' : 'text-mist-500 hover:bg-ink-850 hover:text-mist-100')
              : 'shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium ' + (value === id ? 'border-accent-500 text-mist-100' : 'border-transparent text-mist-500 hover:text-mist-100')
          }
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <h2 className="text-base font-semibold text-mist-100">{title}</h2>
      {hint && <p className="mt-1 text-sm text-mist-500">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

function Switch({ label, on: start = false }: { label: string; on?: boolean }) {
  const [on, setOn] = useState(start)
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-mist-300">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} onClick={() => setOn(!on)} className={'relative h-6 w-11 shrink-0 rounded-full transition-colors ' + (on ? 'bg-accent-500' : 'bg-ink-600')}>
        <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-2 text-sm sm:grid-cols-[200px_1fr]">
      <span className="text-mist-500">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function MockNote() {
  const { t } = useTranslation()
  return <p className="rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">{t('mock.settings')}</p>
}

export function SettingsPage() {
  const { t } = useTranslation()
  const boards = useBoards()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'general'
  const sub = params.get('sub') ?? 'accounts'
  const go = (next: Record<string, string>) => setParams(next)
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('settings.title')}</h1>
        <MockNote />
        <TabRow tabs={[['general', t('settings.general')], ['spaces', t('settings.spaces')], ['server', t('settings.server')]]} value={tab} onChange={(v) => go({ tab: v })} />
        {tab === 'general' && (
          <Card title={t('settings.general')}>
            <Row label={t('settings.startPage')}>
              <select className="nc-field">
                <option>{t('boards.all')}</option>
                <option>{t('settings.lastBoard')}</option>
              </select>
            </Row>
            <Switch label={t('settings.snap')} on />
            <Switch label={t('settings.grid')} on />
            <Switch label={t('settings.toolBack')} on />
          </Card>
        )}
        {tab === 'spaces' && (
          <Card title={t('settings.spaces')} hint={t('settings.spacesHint')}>
            {boards.spaces.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-ink-700 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-sm text-mist-100">{s.name}</span>
                <span className="text-xs text-mist-600">{t(`members.${s.role}`)}</span>
                <span className="flex -space-x-1.5">
                  {s.members.map((m) => (
                    <Avatar key={m.person} person={m.person} className="h-6 w-6 text-[11px]" ring />
                  ))}
                </span>
              </div>
            ))}
          </Card>
        )}
        {tab === 'server' && (
          <>
            <TabRow
              small
              tabs={[
                ['accounts', t('server.accounts')],
                ['signin', t('server.signin')],
                ['public', t('server.public')],
                ['backups', t('server.backups')],
                ['languages', t('server.languages')],
                ['log', t('server.log')],
              ]}
              value={sub}
              onChange={(v) => go({ tab: 'server', sub: v })}
            />
            {sub === 'accounts' && (
              <Card title={t('server.accounts')} hint={t('server.accountsHint')}>
                {PEOPLE.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar person={p.id} className="h-8 w-8 text-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-mist-100">{p.name}</div>
                      <div className="text-xs text-mist-600">{p.email}</div>
                    </div>
                    <span className="text-xs text-mist-500">{p.id === ME ? t('account.operator') : t('server.member')}</span>
                  </div>
                ))}
                <button type="button" className="nc-btn nc-btn-accent mt-2">{t('server.invite')}</button>
              </Card>
            )}
            {sub === 'signin' && (
              <div className="space-y-4">
                <Card title={t('server.oidc')} hint={t('server.oidcHint')}>
                  <Row label={t('server.oidcIssuer')}>
                    <input className="nc-field" placeholder="https://auth.example.com/application/o/nexcanvas/" />
                  </Row>
                  <Row label="Client ID">
                    <input className="nc-field" placeholder="nexcanvas" />
                  </Row>
                  <Switch label={t('server.oidcOnly')} />
                </Card>
                <Card title={t('server.twoFactor')}>
                  <Switch label={t('server.twoFactorRequired')} />
                </Card>
              </div>
            )}
            {sub === 'public' && (
              <Card title={t('server.public')} hint={t('server.publicHint')}>
                <Switch label={t('server.publicAllowed')} on />
              </Card>
            )}
            {sub === 'backups' && (
              <Card title={t('server.backups')} hint={t('server.backupsHint')}>
                <Row label={t('server.schedule')}>
                  <select className="nc-field" defaultValue="daily">
                    <option value="off">{t('server.off')}</option>
                    <option value="daily">{t('server.daily')}</option>
                    <option value="weekly">{t('server.weekly')}</option>
                  </select>
                </Row>
                <Row label={t('server.keep')}>
                  <input className="nc-field w-24" defaultValue="7" />
                </Row>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className="nc-btn nc-btn-accent">{t('server.backupNow')}</button>
                  <button type="button" className="nc-btn nc-btn-ghost">
                    <Upload className="h-4 w-4" />
                    {t('server.restore')}
                  </button>
                </div>
                <ul className="divide-y divide-ink-700/70 rounded-xl border border-ink-700 text-sm">
                  {['2026-10-02 03:00', '2026-10-01 03:00', '2026-09-30 03:00'].map((d) => (
                    <li key={d} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex-1 font-mono text-xs text-mist-300">nexcanvas-{d.replace(/[ :]/g, '-')}.zip</span>
                      <span className="text-xs text-mist-600">4,1 MB</span>
                      <button type="button" className="rounded p-1 text-mist-500 hover:text-mist-100" aria-label={t('server.download')}>
                        <Download className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {sub === 'languages' && (
              <Card title={t('server.languages')} hint={t('server.languagesHint')}>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-300">Deutsch · {t('server.builtIn')}</span>
                  <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-300">English · {t('server.builtIn')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="nc-btn nc-btn-ghost">
                    <Download className="h-4 w-4" />
                    {t('server.template')}
                  </button>
                  <button type="button" className="nc-btn nc-btn-ghost">
                    <Upload className="h-4 w-4" />
                    {t('server.upload')}
                  </button>
                </div>
              </Card>
            )}
            {sub === 'log' && (
              <Card title={t('server.log')} hint={t('server.logHint')}>
                <Row label={t('server.level')}>
                  <select className="nc-field" defaultValue="normal">
                    {['quiet', 'normal', 'detailed', 'trace'].map((l) => (
                      <option key={l} value={l}>
                        {t(`server.levels.${l}`)}
                      </option>
                    ))}
                  </select>
                </Row>
                <pre className="nc-scroll max-h-56 overflow-auto rounded-xl border border-ink-700 bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-mist-400">
                  {`2026-10-02 21:04:11 INFO  nexcanvas.boards [a81f] | board saved (42 items)
2026-10-02 21:03:58 INFO  nexcanvas.auth   [a7c2] | signed in via OIDC
2026-10-02 03:00:02 INFO  nexcanvas.backup [-]    | backup written (4.1 MB, 7 kept)
2026-10-01 22:17:40 WARN  nexcanvas.media  [9e03] | upload refused: larger than 50 MB`}
                </pre>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  )
}

export function AccountPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'profile'
  const me = PEOPLE.find((p) => p.id === ME)!
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-bold tracking-tight text-mist-100">{t('account.mine')}</h1>
        <MockNote />
        <TabRow tabs={[['profile', t('account.profile')], ['security', t('account.security')], ['connections', t('account.connections')]]} value={tab} onChange={(v) => setParams({ tab: v })} />
        {tab === 'profile' && (
          <Card title={t('account.profile')}>
            <div className="flex items-center gap-4">
              <Avatar person={ME} className="h-16 w-16 text-2xl" />
              <button type="button" className="nc-btn nc-btn-ghost">{t('account.picture')}</button>
            </div>
            <Row label={t('account.displayName')}>
              <input className="nc-field" defaultValue={me.name} />
            </Row>
            <Row label={t('account.email')}>
              <input className="nc-field" defaultValue={me.email} />
            </Row>
          </Card>
        )}
        {tab === 'security' && (
          <div className="space-y-4">
            <Card title={t('account.password')}>
              <button type="button" className="nc-btn nc-btn-ghost">
                <KeyRound className="h-4 w-4" />
                {t('account.changePassword')}
              </button>
            </Card>
            <Card title={t('server.twoFactor')} hint={t('account.twoFactorHint')}>
              <button type="button" className="nc-btn nc-btn-accent">
                <ShieldCheck className="h-4 w-4" />
                {t('account.twoFactorSetup')}
              </button>
            </Card>
          </div>
        )}
        {tab === 'connections' && (
          <Card title={t('account.apiTokens')} hint={t('account.apiHint')}>
            <button type="button" className="nc-btn nc-btn-accent">{t('account.newToken')}</button>
          </Card>
        )}
      </div>
    </main>
  )
}

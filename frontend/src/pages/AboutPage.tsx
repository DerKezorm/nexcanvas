/**
 * About nexcanvas, as nexlore's (pages/AboutPage.tsx): version, licence, where it comes from, whether a newer one is
 * out, and what it is built with. Reached from the account menu, like there.
 *
 * The switch for the daily check stands here, where its answer shows, and the page says what goes out: the question
 * to GitHub is the one call nexcanvas makes by itself. Every account sees the answer; switching and asking now belong
 * to the operator, because the question goes out for the whole installation.
 */
import { BookOpen, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '../api/client'
import { Logo } from '../components/Logo'
import { WhatsNewWindow } from '../components/WhatsNew'
import { moment } from '../lib/time'
import { useWhatsNew } from '../lib/whatsNew'
import { useAuth } from '../state/auth'
import { Button, Card, Feedback, Toggle } from './settings/ui'
import { useTitle } from '../lib/title'

type About = { version: string; license: string; repo_url: string; releases_url: string; project_url: string }
type Updates = { update_check: boolean; checked: boolean; latest: string | null; newer: boolean; checked_at: string | null; release_url: string | null }

const PARTS = [
  { name: 'FastAPI', url: 'https://fastapi.tiangolo.com', licence: 'MIT' },
  { name: 'SQLAlchemy', url: 'https://www.sqlalchemy.org', licence: 'MIT' },
  { name: 'SQLite', url: 'https://sqlite.org', licence: 'Public Domain' },
  { name: 'pycrdt', url: 'https://github.com/y-crdt/pycrdt', licence: 'MIT' },
  { name: 'Pillow', url: 'https://python-pillow.org', licence: 'MIT-CMU' },
  { name: 'pillow-heif', url: 'https://github.com/bigcat88/pillow_heif', licence: 'BSD-3' },
  { name: 'pypdf', url: 'https://github.com/py-pdf/pypdf', licence: 'BSD-3' },
  { name: 'React', url: 'https://react.dev', licence: 'MIT' },
  { name: 'Vite', url: 'https://vite.dev', licence: 'MIT' },
  { name: 'Tailwind CSS', url: 'https://tailwindcss.com', licence: 'MIT' },
  { name: 'Yjs', url: 'https://yjs.dev', licence: 'MIT' },
  { name: 'perfect-freehand', url: 'https://github.com/steveruizok/perfect-freehand', licence: 'MIT' },
  { name: 'PDF.js', url: 'https://mozilla.github.io/pdf.js/', licence: 'Apache-2.0' },
  { name: 'html-to-image', url: 'https://github.com/bubkoo/html-to-image', licence: 'MIT' },
  { name: 'Lucide', url: 'https://lucide.dev', licence: 'ISC' },
  { name: 'i18next', url: 'https://www.i18next.com', licence: 'MIT' },
  { name: 'Inter', url: 'https://rsms.me/inter/', licence: 'OFL-1.1' },
]

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:decoration-accent-400">
      {children}
    </a>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-ink-700/60 py-2.5 last:border-b-0">
      <dt className="text-sm text-mist-500">{label}</dt>
      <dd className="text-sm font-medium text-mist-100">{children}</dd>
    </div>
  )
}

function code(error: unknown): string {
  return error instanceof ApiError ? error.code : 'internal_error'
}

export function AboutPage() {
  const { t, i18n } = useTranslation()
  useTitle(t('about.menu'))
  const { me } = useAuth()
  const operator = me?.role === 'operator'
  const [about, setAbout] = useState<About | null>(null)
  const [updates, setUpdates] = useState<Updates | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The written text of the running version, to read again at any time.
  const { entry } = useWhatsNew(me?.version, i18n.language)
  const [reading, setReading] = useState(false)

  const load = useCallback(() => {
    api<About>('/api/about').then(setAbout, (error: unknown) => setProblem(code(error)))
    // The answer is a side matter: when it does not come, the page simply shows none.
    api<Updates>('/api/about/updates').then(setUpdates, () => setUpdates(null))
  }, [])
  useEffect(load, [load])

  async function checkNow() {
    setBusy(true)
    try {
      setUpdates(await api<Updates>('/api/about/updates/check', { method: 'POST' }))
      setProblem(null)
    } catch (error) {
      setProblem(code(error))
    } finally {
      setBusy(false)
    }
  }

  async function switchCheck(on: boolean) {
    if (updates) setUpdates({ ...updates, update_check: on })
    try {
      setUpdates(await api<Updates>('/api/about/updates', { method: 'PUT', body: { update_check: on } }))
    } catch (error) {
      setProblem(code(error))
      load()
    }
  }

  const latest = updates?.latest?.replace(/^v/, '')
  return (
    <main className="nc-scroll min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-mist-100">nexcanvas</h1>
            <p className="text-sm text-mist-500">{t('about.subtitle')}</p>
          </div>
        </div>
        <Feedback problem={problem} />
        {about && (
          <dl className="rounded-2xl border border-ink-700 bg-ink-900 px-5 py-2" data-testid="about-facts">
            <Row label={t('about.version')}>
              <span className="flex flex-wrap items-center gap-2">
                <span data-testid="about-version">{about.version}</span>
                {updates?.newer && <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">{t('about.newer', { version: latest })}</span>}
              </span>
            </Row>
            {entry && me && (
              <Row label={t('about.whatsNew')}>
                <button type="button" onClick={() => setReading(true)} className="text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:decoration-accent-400">
                  {t('whatsNew.title', { version: me.version })}
                </button>
              </Row>
            )}
            <Row label={t('about.licence')}>
              <Out href="https://www.gnu.org/licenses/agpl-3.0.html">{about.license}</Out>
            </Row>
            <Row label={t('about.source')}>
              <Out href={about.repo_url}>{about.repo_url.replace(/^https:\/\//, '')}</Out>
            </Row>
            <Row label={t('about.releases')}>
              <Out href={about.releases_url}>{t('about.releasesLink')}</Out>
            </Row>
            {about.project_url && (
              <Row label={t('about.project')}>
                <Out href={about.project_url}>{about.project_url.replace(/^https:\/\//, '')}</Out>
              </Row>
            )}
            <Row label={t('about.report')}>
              <Out href={`${about.repo_url}/issues/new`}>{t('about.reportLink')}</Out>
            </Row>
          </dl>
        )}

        <Card icon={RefreshCw} title={t('about.updates.title')} text={t('about.updates.text')} id="about-updates">
          {operator && updates && <Toggle label={t('about.updates.daily')} hint={t('about.updates.dailyHint')} checked={updates.update_check} onChange={(on) => void switchCheck(on)} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-live="polite">
            {operator && (
              <Button onClick={() => void checkNow()} busy={busy}>
                {t('about.updates.now')}
              </Button>
            )}
            <span data-testid="about-update-state" className="text-mist-400">
              {!updates || !updates.checked ? (
                updates && !updates.update_check ? t('about.updates.off') : t('about.updates.notYet')
              ) : updates.newer ? (
                <>
                  {t('about.newer', { version: latest })}
                  {updates.release_url && (
                    <>
                      {' · '}
                      <Out href={updates.release_url}>{t('about.updates.toRelease')}</Out>
                    </>
                  )}
                </>
              ) : updates.latest ? (
                t('about.updates.current')
              ) : (
                t('about.updates.none')
              )}
            </span>
            {updates?.checked_at && <span className="text-xs text-mist-500">{t('about.updates.checkedAt', { when: moment(updates.checked_at, i18n.language) })}</span>}
          </div>
          <p className="text-xs leading-relaxed text-mist-500">{t('about.updates.whatGoesOut')}</p>
        </Card>

        <Card icon={BookOpen} title={t('about.builtWith')}>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-sm">
            {PARTS.map((part) => (
              <li key={part.name}>
                <Out href={part.url}>{part.name}</Out>
                <span className="ml-1 text-xs text-mist-500">({part.licence})</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {reading && entry && me && <WhatsNewWindow version={me.version} entry={entry} onClose={() => setReading(false)} />}
    </main>
  )
}

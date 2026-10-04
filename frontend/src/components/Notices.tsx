import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/client'
import { useBoards } from '../board/store'
import { errorText } from '../lib/errors'
import { answerNotice, type Notice } from '../lib/notices'
import { useAuth } from '../state/auth'

/** The waiting notices as lines with their buttons, as in nexlore's sidebar: accept or decline, or mark seen. */
export function NoticeList({ notices }: { notices: Notice[] }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const boards = useBoards()
  const [problem, setProblem] = useState<string | null>(null)
  const answer = (notice: Notice, accept: boolean) => {
    setProblem(null)
    answerNotice(notice.id, accept).then(
      () => accept && void boards.refresh(),
      (error: unknown) => setProblem(error instanceof ApiError ? error.code : 'internal_error'),
    )
  }
  return (
    <>
      <ul className="space-y-1">
        {notices.map((notice) => (
          <li key={notice.id} data-notice={notice.kind} className="rounded-lg px-2.5 py-1.5 text-[13px] text-mist-300">
            <p>{t(`notices.${notice.kind}${notice.kind.startsWith('operator_') && notice.subject === me?.name ? '_self' : ''}`, { actor: notice.actor, subject: notice.subject, space: notice.space, role: notice.role ? t(`roles.${notice.role}`) : '' })}</p>
            <div className="mt-1 flex gap-1.5">
              {notice.kind === 'invite' ? (
                <>
                  <button type="button" onClick={() => answer(notice, true)} className="rounded-md bg-accent-500/15 px-2 py-0.5 text-xs text-accent-300 hover:bg-accent-500/25">
                    {t('notices.accept')}
                  </button>
                  <button type="button" onClick={() => answer(notice, false)} className="rounded-md px-2 py-0.5 text-xs text-mist-400 hover:bg-ink-850">
                    {t('notices.decline')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => answer(notice, false)} className="rounded-md px-2 py-0.5 text-xs text-mist-400 hover:bg-ink-850">
                  {t('notices.seen')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="px-2.5 text-xs text-bad-500">
          {errorText(problem)}
        </p>
      )}
    </>
  )
}

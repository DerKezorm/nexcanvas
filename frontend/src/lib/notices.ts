/**
 * What waits for the own account, as nexlore's "New" (lib/news.ts): invitations into a space by name, to accept or
 * decline, and what the operator changed in a space one is in, to mark seen. Asked when the app starts, every minute
 * and when the tab comes back; the account menu and the sidebar show the same list.
 */
import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../api/client'

export type Notice = { id: number; kind: 'invite' | 'operator_added' | 'operator_role' | 'operator_removed'; space: string; role: string; actor: string; subject: string; created_at: string }

let list: Notice[] = []
const listeners = new Set<() => void>()
let users = 0
let timer: number | undefined

function tell() {
  for (const listener of listeners) listener()
}

export async function reloadNotices(): Promise<void> {
  try {
    list = await api<Notice[]>('/api/notices')
  } catch {
    // Signed out or offline: keep what was there; the next round asks again.
    return
  }
  tell()
}

/** Accept (an invitation) or decline it; for the other kinds "decline" marks the notice seen. */
export async function answerNotice(id: number, accept: boolean): Promise<void> {
  await api(`/api/notices/${id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' })
  list = list.filter((notice) => notice.id !== id)
  tell()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const again = () => {
  if (document.visibilityState === 'visible') void reloadNotices()
}

export function useNotices(): Notice[] {
  useEffect(() => {
    users += 1
    if (users === 1) {
      void reloadNotices()
      timer = window.setInterval(again, 60_000)
      document.addEventListener('visibilitychange', again)
    }
    return () => {
      users -= 1
      if (users === 0) {
        window.clearInterval(timer)
        document.removeEventListener('visibilitychange', again)
      }
    }
  }, [])
  return useSyncExternalStore(subscribe, () => list)
}

import type { RecentListen } from '@/core/clients/listenbrainz'
import { errMsg } from '@/core/validation'

export type RecentlyPlayedStatus = 'ok' | 'missing' | 'capped' | 'partial' | 'disabled'

export type RecentlyPlayedHistory = {
  status: RecentlyPlayedStatus
  windowDays: number
  listensRead: number
  recordingMbids: Set<string>
  error?: string
}

export type ListensPageReader = (
  count: number,
  options: { maxTs?: number },
) => Promise<RecentListen[]>

export const RECENTLY_PLAYED_PAGE_SIZE = 1000
export const RECENTLY_PLAYED_MAX_LISTENS = 5000

/**
 * Read the user's ListenBrainz listens inside the window, newest first. Pages
 * walk backwards with `max_ts` (LB accepts only one of min_ts/max_ts) and stop
 * at the window start, an empty page, or the listen cap. A failed page keeps
 * what was already read and reports `partial`.
 */
export async function loadRecentlyPlayed(options: {
  enabled: boolean
  windowDays: number
  readPage: ListensPageReader | null
  now?: Date
  maxListens?: number
  pageSize?: number
}): Promise<RecentlyPlayedHistory> {
  const { windowDays } = options
  const recordingMbids = new Set<string>()
  if (!options.enabled) return { status: 'disabled', windowDays, listensRead: 0, recordingMbids }
  if (!options.readPage) return { status: 'missing', windowDays, listensRead: 0, recordingMbids }

  const maxListens = options.maxListens ?? RECENTLY_PLAYED_MAX_LISTENS
  const pageSize = options.pageSize ?? RECENTLY_PLAYED_PAGE_SIZE
  const cutoff = Math.floor((options.now ?? new Date()).getTime() / 1000) - windowDays * 86_400
  let listensRead = 0
  let maxTs: number | undefined

  try {
    while (listensRead < maxListens) {
      const page = await options.readPage(pageSize, maxTs === undefined ? {} : { maxTs })
      if (page.length === 0) return { status: 'ok', windowDays, listensRead, recordingMbids }
      let oldest = Number.POSITIVE_INFINITY
      for (const listen of page) {
        oldest = Math.min(oldest, listen.listenedAt)
        if (listen.listenedAt < cutoff || listensRead >= maxListens) continue
        listensRead++
        if (listen.recordingMbid) recordingMbids.add(listen.recordingMbid)
      }
      if (oldest < cutoff) return { status: 'ok', windowDays, listensRead, recordingMbids }
      maxTs = oldest
    }
    return { status: 'capped', windowDays, listensRead, recordingMbids }
  } catch (err) {
    return { status: 'partial', windowDays, listensRead, recordingMbids, error: errMsg(err) }
  }
}

/** True when the exclusion left fewer than 5 results or under a quarter of what the run would have stored. */
export function recentlyPlayedLeftTooFew(before: number, kept: number): boolean {
  if (before === kept) return false
  return kept < 5 || kept < before * 0.25
}

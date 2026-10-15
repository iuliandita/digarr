import { Cron } from 'croner'
import { createTranslator } from '@/core/i18n/translator'
import type { DispatchResult } from '@/core/notifications/registry'
import type { NotificationChannel, WebhookPayload } from '@/core/notifications/types'
import { isMaintenance } from '@/core/ops/maintenance'
import type { DigestStats } from '@/db/queries/jobs'

export type DigestNotifierDeps = {
  /** Read the live digest cron expression; empty/undefined disables the job. */
  getDigestCron: () => Promise<string | undefined> | string | undefined
  /** Read the live notification channels; none subscribed to 'digest' disables the job. */
  getChannels: () => Promise<NotificationChannel[] | undefined> | NotificationChannel[] | undefined
  /** Aggregate stats for the trailing window starting at `since`. */
  getStats: (since: Date) => Promise<DigestStats>
  /** Notification dispatcher (injected so the job is unit-testable without network). */
  dispatch: (
    channels: NotificationChannel[],
    event: 'digest',
    payload: WebhookPayload,
  ) => Promise<DispatchResult[]>
  initializeDeliveryPositions: (channelIds: string[]) => Promise<Record<string, string | null>>
  getDeliveryPositions: () => Promise<Record<string, string | null>>
  setDeliveryPosition: (channelId: string, at: Date) => Promise<void>
  /** Shared across scheduler replacements to keep an unfinished tick exclusive. */
  inFlight?: { running: boolean }
}

/**
 * Compute the trailing window for a digest fire from the cron cadence itself.
 * Used as the fallback when the persisted last-sent bookmark is unset (first
 * fire) or in the future (clock skew / restored backup). The window is the gap
 * between `from` (the current fire, e.g. daily -> ~24h, weekly -> ~7d) and the
 * scheduled fire before it, so irregular cadences (e.g. Mon+Fri) get the
 * actual elapsed interval instead of the gap to the *next* fire. Falls back
 * to 24h if the cadence cannot be derived.
 */
export function windowMsFromCron(cronExpr: string, from: Date = new Date()): number {
  const dayMs = 24 * 60 * 60 * 1000
  const granuleMs = 60 * 1000
  try {
    const probe = new Cron(cronExpr)
    const [first, second] = probe.previousRuns(2, from)
    probe.stop()
    // A "previous" fire within one minute of `from` is the current fire
    // observed by a late tick (5-field crons space fires >=1min apart).
    const prev = first && from.getTime() - first.getTime() < granuleMs ? second : first
    if (prev) {
      const gap = from.getTime() - prev.getTime()
      if (gap > 0) return gap
    }
  } catch {
    // invalid cron -> default window
  }
  return dayMs
}

function windowLabel(windowMs: number, t: ReturnType<typeof createTranslator>): string {
  const dayMs = 24 * 60 * 60 * 1000
  return windowMs >= 6 * dayMs
    ? t('notifications.digest.window.week')
    : t('notifications.digest.window.day')
}

/** Start the digest schedule after initializing existing channel positions, even when disabled. */
export async function startDigestNotifier(deps: DigestNotifierDeps): Promise<Cron | null> {
  const channels = await deps.getChannels()
  await deps.initializeDeliveryPositions([
    ...new Set((channels ?? []).map((channel) => channel.id)),
  ])
  const cronExpr = await deps.getDigestCron()
  if (!cronExpr) return null

  const inFlight = deps.inFlight ?? { running: false }
  return new Cron(cronExpr, async () => {
    if (inFlight.running) return
    inFlight.running = true
    try {
      if (isMaintenance()) {
        console.log('[digest-notifier] tick skipped: maintenance in progress')
        return
      }
      const [liveCron, liveChannels] = await Promise.all([deps.getDigestCron(), deps.getChannels()])
      if (!liveCron) return
      const idCounts = new Map<string, number>()
      for (const channel of liveChannels ?? []) {
        idCounts.set(channel.id, (idCounts.get(channel.id) ?? 0) + 1)
      }
      const digestChannels = (liveChannels ?? []).filter(
        (channel) => channel.enabled && channel.events.includes('digest'),
      )
      if (digestChannels.length === 0) return

      await deps.initializeDeliveryPositions([...idCounts.keys()])
      const now = new Date()
      const positions = await deps.getDeliveryPositions()
      for (const channel of digestChannels) {
        if (idCounts.get(channel.id) !== 1) {
          console.error('[digest-notifier] Duplicate channel ID skipped:', channel.id)
          continue
        }
        try {
          const position = Object.hasOwn(positions, channel.id) ? positions[channel.id] : null
          const saved = position ? new Date(position) : null
          const valid =
            saved && Number.isFinite(saved.getTime()) && saved.getTime() <= now.getTime()
          if (valid && saved.getTime() === now.getTime()) continue
          const since = valid ? saved : new Date(now.getTime() - windowMsFromCron(liveCron, now))
          // Keep a first failed window stable across retries and process restarts.
          if (!valid) await deps.setDeliveryPosition(channel.id, since)
          const stats = await deps.getStats(since)
          if (stats.discovered === 0 && stats.added === 0 && stats.runs === 0) {
            await deps.setDeliveryPosition(channel.id, now)
            continue
          }

          const t = createTranslator('en')
          const label = windowLabel(now.getTime() - since.getTime(), t)
          const results = await deps.dispatch([channel], 'digest', {
            event: 'digest',
            window: label,
            stats,
            message: t(
              'notifications.digest.message',
              label,
              String(stats.discovered),
              String(stats.added),
              String(stats.runs),
            ),
            timestamp: now.toISOString(),
          })
          const result = results[0]
          // A crash after remote acceptance can replay this channel's window.
          if (
            results.length === 1 &&
            result?.id === channel.id &&
            result.type === channel.type &&
            result.ok === true
          ) {
            await deps.setDeliveryPosition(channel.id, now)
          }
        } catch (err: unknown) {
          console.error('[digest-notifier] Channel failed:', channel.id, err)
        }
      }
    } catch (err: unknown) {
      console.error('[digest-notifier] Failed:', err)
    } finally {
      inFlight.running = false
    }
  })
}

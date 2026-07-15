import { Cron } from 'croner'
import { createTranslator } from '@/core/i18n/translator'
import { isMaintenance } from '@/core/ops/maintenance'
import type { DigestStats } from '@/db/queries/jobs'

export type DigestNotifierDeps = {
  /** Read the live digest cron expression; empty/undefined disables the job. */
  getDigestCron: () => Promise<string | undefined> | string | undefined
  /** Read the live webhook URL; empty/undefined disables the job. */
  getWebhookUrl: () => Promise<string | undefined> | string | undefined
  /** Aggregate stats for the trailing window starting at `since`. */
  getStats: (since: Date) => Promise<DigestStats>
  /** Webhook sender (injected so the job is unit-testable without network). */
  sendWebhook: (
    url: string,
    payload: import('@/core/notifications').WebhookPayload,
  ) => Promise<void>
  /** Read the persisted last-sent bookmark; null = never sent. */
  getLastSentAt: () => Promise<Date | null>
  /** Persist the bookmark after a covered window (sent OR zero-activity). */
  setLastSentAt: (at: Date) => Promise<void>
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

/**
 * Start the scheduled notification digest. Modeled on `startStuckDetector`:
 * one Cron, body wrapped in try/catch. Reads prefs each fire so the digest can
 * be toggled at runtime. No-ops when `digestCron` or `webhookUrl` is unset;
 * a zero-activity window sends nothing but still advances the bookmark.
 * Returns null when no cron is configured at boot (digest disabled).
 */
export async function startDigestNotifier(deps: DigestNotifierDeps): Promise<Cron | null> {
  const cronExpr = await deps.getDigestCron()
  if (!cronExpr) return null

  return new Cron(cronExpr, async () => {
    if (isMaintenance()) {
      console.log('[digest-notifier] tick skipped: maintenance in progress')
      return
    }
    try {
      const [liveCron, webhookUrl] = await Promise.all([deps.getDigestCron(), deps.getWebhookUrl()])
      if (!liveCron || !webhookUrl) return

      const now = new Date()
      const lastSentAt = await deps.getLastSentAt()
      // A bookmark in the future (clock skew, restored backup) falls back to
      // the cron window rather than producing a negative range.
      const since =
        lastSentAt && lastSentAt.getTime() < now.getTime()
          ? lastSentAt
          : new Date(now.getTime() - windowMsFromCron(liveCron, now))
      const windowMs = now.getTime() - since.getTime()
      const stats = await deps.getStats(since)

      if (stats.discovered === 0 && stats.added === 0 && stats.runs === 0) {
        await deps.setLastSentAt(now)
        return
      }

      const t = createTranslator('en')
      const label = windowLabel(windowMs, t)
      const message = t(
        'notifications.digest.message',
        label,
        String(stats.discovered),
        String(stats.added),
        String(stats.runs),
      )

      await deps.sendWebhook(webhookUrl, {
        event: 'digest',
        window: label,
        stats,
        message,
        timestamp: new Date().toISOString(),
      })
      // Only after a successful send: a failed send must not advance the
      // bookmark, so the next fire re-covers the window (at-least-once).
      await deps.setLastSentAt(now)
    } catch (err: unknown) {
      console.error('[digest-notifier] Failed:', err)
    }
  })
}

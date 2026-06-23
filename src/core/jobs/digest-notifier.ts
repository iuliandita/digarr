import { Cron } from 'croner'
import { createTranslator } from '@/core/i18n/translator'
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
}

/**
 * Compute the trailing window for a digest fire from the cron cadence itself,
 * so no "last sent" bookmark needs persisting. The window is the gap between
 * the next two scheduled fires of `cronExpr` (e.g. daily -> ~24h, weekly ->
 * ~7d). Falls back to 24h if the cadence cannot be derived.
 */
export function windowMsFromCron(cronExpr: string, from: Date = new Date()): number {
  const dayMs = 24 * 60 * 60 * 1000
  try {
    const probe = new Cron(cronExpr)
    const [first, second] = probe.nextRuns(2, from)
    probe.stop()
    if (first && second) {
      const gap = second.getTime() - first.getTime()
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
 * be toggled at runtime. No-ops when `digestCron` or `webhookUrl` is unset, or
 * when the window had zero activity. Returns null when no cron is configured at
 * boot (digest disabled).
 */
export async function startDigestNotifier(deps: DigestNotifierDeps): Promise<Cron | null> {
  const cronExpr = await deps.getDigestCron()
  if (!cronExpr) return null

  return new Cron(cronExpr, async () => {
    try {
      const [liveCron, webhookUrl] = await Promise.all([deps.getDigestCron(), deps.getWebhookUrl()])
      if (!liveCron || !webhookUrl) return

      const windowMs = windowMsFromCron(liveCron)
      const since = new Date(Date.now() - windowMs)
      const stats = await deps.getStats(since)

      if (stats.discovered === 0 && stats.added === 0 && stats.runs === 0) return

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
    } catch (err: unknown) {
      console.error('[digest-notifier] Failed:', err)
    }
  })
}

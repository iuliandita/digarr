import { Hono } from 'hono'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import {
  aiReasoningAudit,
  clearImageFailures,
  dedupeRepair,
  getAiAuditStatus,
  purgeSessions,
  rebuildGenres,
  rescoreRecommendations,
} from '@/core/ops/hygiene'
import type { BackupFile, OpsDb } from '@/core/ops/types'
import { getPendingMigrations } from '@/core/ops/upgrade'
import { isValidStatus } from '@/core/recommendations/statuses'
import { mergePreferences, type Preferences } from '@/db/schema'
import { backupFileSchema } from '@/server/schemas/admin'
import type { HonoEnv } from '@/server/types'

export interface AdminDeps {
  db: OpsDb
  getUserById: (
    id: number,
  ) => Promise<{ isAdmin: boolean; preferences?: Partial<Preferences> | null } | null>
  getSettings: () => Promise<{ preferences?: Partial<Preferences> | null } | null>
  generateReasoning?: (artistName: string, genres: string[]) => Promise<string>
}

export function adminRoutes(deps: AdminDeps) {
  const router = new Hono<HonoEnv>()

  // POST /api/admin/backup - download backup JSON
  router.post('/api/admin/backup', async (c) => {
    const includeCaches = c.req.query('includeCaches') === 'true'
    const backup = await createBackup(deps.db, { includeCaches })
    const json = JSON.stringify(backup, null, 2)
    const timestamp = new Date().toISOString().slice(0, 10)
    const suffix = includeCaches ? '-full' : ''

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="digarr-backup-${timestamp}${suffix}.json"`,
      },
    })
  })

  // POST /api/admin/restore - upload and restore backup JSON.
  // Dual-format (multipart + raw JSON) rules out zJson middleware; we parse
  // then validate with the same schema in-handler. Zod catches prototype
  // pollution, missing top-level keys, and non-array table payloads before
  // restoreBackup touches the DB.
  router.post('/api/admin/restore', async (c) => {
    const force = c.req.query('force') === 'true'
    const confirm = c.req.query('confirm') === 'true'
    if (!confirm) {
      return c.json(
        {
          error: 'Restore overwrites existing data. Re-submit with ?confirm=true to acknowledge.',
          code: 'confirmation_required' as const,
        },
        400,
      )
    }
    const contentType = c.req.header('content-type') ?? ''

    let raw: unknown
    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.formData()
        const file = form.get('file')
        if (!file || !(file instanceof File)) {
          return c.json({ error: 'No file provided' }, 400)
        }
        const text = await file.text()
        raw = JSON.parse(text)
      } else {
        raw = await c.req.json()
      }
    } catch {
      return c.json({ error: 'Invalid backup file format' }, 400)
    }

    const parsed = backupFileSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first?.path.length ? first.path.join('.') : 'root'
      return c.json(
        {
          error: `Invalid backup file structure at ${where}: ${first?.message ?? 'unknown'}`,
          code: 'validation_failed' as const,
          details: parsed.error.issues.map((i) => ({
            path: i.path,
            code: i.code,
            message: i.message,
          })),
        },
        400,
      )
    }
    const backup: BackupFile = parsed.data as BackupFile

    let result: Awaited<ReturnType<typeof restoreBackup>>
    try {
      result = await restoreBackup(deps.db, backup, { force })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Restore failed (rolled back): ${msg}` }, 500)
    }

    if (result.encryptionMismatch && !force) {
      return c.json(
        {
          error: 'Encryption key mismatch',
          affectedFields: result.affectedEncryptedFields,
          hint: 'Add ?force=true to restore anyway. Encrypted fields will need re-entry.',
        },
        409,
      )
    }

    return c.json(result)
  })

  // GET /api/admin/backup/last - last auto-backup metadata
  router.get('/api/admin/backup/last', async (c) => {
    const status = await getPendingMigrations(deps.db)
    return c.json({ lastAutoBackup: status.lastAutoBackup })
  })

  // GET /api/admin/migrations/pending - pending migration status
  router.get('/api/admin/migrations/pending', async (c) => {
    const status = await getPendingMigrations(deps.db)
    return c.json(status)
  })

  // ── Hygiene endpoints ─────────────────────────

  router.post('/api/admin/hygiene/clear-image-failures', async (c) => {
    const olderThan = c.req.query('olderThan')
    let days: number | undefined
    if (olderThan) {
      const match = olderThan.match(/^(\d+)d$/)
      if (match?.[1]) days = Number.parseInt(match[1], 10)
    }
    const result = await clearImageFailures(deps.db, days)
    return c.json(result)
  })

  router.post('/api/admin/hygiene/rebuild-genres', async (c) => {
    const result = await rebuildGenres(deps.db)
    return c.json(result)
  })

  router.post('/api/admin/hygiene/rescore', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'No user context' }, 400)

    const user = await deps.getUserById(userId)
    const prefs = mergePreferences(user?.preferences)
    const statusParam = c.req.query('status') ?? 'pending'
    const statuses = statusParam.split(',').filter((s) => isValidStatus(s))
    if (statuses.length === 0) {
      return c.json({ error: 'No valid status values provided' }, 400)
    }

    // Library genres unavailable in offline rescore - zero the weight to avoid score drift
    const adjustedWeights = { ...prefs.scoringWeights, genreOverlap: 0 }
    const result = await rescoreRecommendations(deps.db, adjustedWeights, [], statuses)
    return c.json(result)
  })

  router.post('/api/admin/hygiene/dedupe', async (c) => {
    const result = await dedupeRepair(deps.db)
    return c.json(result)
  })

  router.post('/api/admin/hygiene/ai-audit', async (c) => {
    const autoFix = c.req.query('autoFix') === 'true'

    const result = await aiReasoningAudit(
      deps.db,
      autoFix && deps.generateReasoning
        ? { enabled: true, generateReasoning: deps.generateReasoning }
        : undefined,
    )

    if (result.autoFixStarted) {
      return c.json(result, 202)
    }
    return c.json(result)
  })

  router.get('/api/admin/hygiene/ai-audit/results', async (c) => {
    return c.json(getAiAuditStatus())
  })

  router.post('/api/admin/hygiene/purge-sessions', async (c) => {
    const result = await purgeSessions(deps.db)
    return c.json(result)
  })

  return router
}

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
import { migrateBackend } from '@/core/ops/migrate-backend'
import type { BackupFile, OpsDb } from '@/core/ops/types'
import { getPendingMigrations } from '@/core/ops/upgrade'
import { isValidStatus } from '@/core/recommendations/statuses'
import { logAndSanitize } from '@/core/validation'
import { assertSafePglitePath, connectTarget } from '@/db/connect'
import { mergePreferences, type Preferences } from '@/db/schema'
import { setMaintenance } from '@/server/maintenance'
import { backupFileSchema } from '@/server/schemas/admin'
import { migrateRequestSchema, migrateTargetSchema } from '@/server/schemas/migrate'
import type { HonoEnv } from '@/server/types'

export interface AdminDeps {
  db: OpsDb
  isPipelineRunning: () => boolean
  getUserById: (
    id: number,
  ) => Promise<{ isAdmin: boolean; preferences?: Partial<Preferences> | null } | null>
  getSettings: () => Promise<{ preferences?: Partial<Preferences> | null } | null>
  generateReasoning?: (artistName: string, genres: string[]) => Promise<string>
}

export function adminRoutes(deps: AdminDeps) {
  const router = new Hono<HonoEnv>()

  // POST /api/v1/admin/backup - download backup JSON
  router.post('/api/v1/admin/backup', async (c) => {
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

  // POST /api/v1/admin/restore - upload and restore backup JSON.
  // Dual-format (multipart + raw JSON) rules out zJson middleware; we parse
  // then validate with the same schema in-handler. Zod catches prototype
  // pollution, missing top-level keys, and non-array table payloads before
  // restoreBackup touches the DB.
  router.post('/api/v1/admin/restore', async (c) => {
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
      const message = logAndSanitize(err, 'admin-restore')
      return c.json({ error: `Restore failed (rolled back): ${message}` }, 500)
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

  // GET /api/v1/admin/backup/last - last auto-backup metadata
  router.get('/api/v1/admin/backup/last', async (c) => {
    const status = await getPendingMigrations(deps.db)
    return c.json({ lastAutoBackup: status.lastAutoBackup })
  })

  // GET /api/v1/admin/migrations/pending - pending migration status
  router.get('/api/v1/admin/migrations/pending', async (c) => {
    const status = await getPendingMigrations(deps.db)
    return c.json(status)
  })

  // ── Hygiene endpoints ─────────────────────────

  router.post('/api/v1/admin/hygiene/clear-image-failures', async (c) => {
    const olderThan = c.req.query('olderThan')
    let days: number | undefined
    if (olderThan) {
      const match = olderThan.match(/^(\d+)d$/)
      if (match?.[1]) days = Number.parseInt(match[1], 10)
    }
    const result = await clearImageFailures(deps.db, days)
    return c.json(result)
  })

  router.post('/api/v1/admin/hygiene/rebuild-genres', async (c) => {
    const result = await rebuildGenres(deps.db)
    return c.json(result)
  })

  router.post('/api/v1/admin/hygiene/rescore', async (c) => {
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

  router.post('/api/v1/admin/hygiene/dedupe', async (c) => {
    const result = await dedupeRepair(deps.db)
    return c.json(result)
  })

  router.post('/api/v1/admin/hygiene/ai-audit', async (c) => {
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

  router.get('/api/v1/admin/hygiene/ai-audit/results', async (c) => {
    return c.json(getAiAuditStatus())
  })

  router.post('/api/v1/admin/hygiene/purge-sessions', async (c) => {
    const result = await purgeSessions(deps.db)
    return c.json(result)
  })

  // POST /api/v1/admin/migrate-backend/test - validate target reachability.
  // For PGlite this is NON-DESTRUCTIVE: assertSafePglitePath validates containment
  // without creating the database file.
  router.post('/api/v1/admin/migrate-backend/test', async (c) => {
    const parsed = migrateTargetSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: 'Invalid target', details: parsed.error.issues }, 400)
    try {
      if (parsed.data.backend === 'pglite') {
        const abs = assertSafePglitePath(parsed.data.path)
        return c.json({ ok: true, backend: 'pglite', description: `PGlite file at ${abs}` })
      }
      const conn = await connectTarget(parsed.data)
      try {
        await conn.ping()
        return c.json({ ok: true, backend: 'postgres', description: conn.describe() })
      } finally {
        await conn.close()
      }
    } catch (err) {
      return c.json({ ok: false, error: logAndSanitize(err, 'migrate-test') }, 502)
    }
  })

  // POST /api/v1/admin/migrate-backend - copy all data into target backend.
  router.post('/api/v1/admin/migrate-backend', async (c) => {
    const parsed = migrateRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400)
    if (deps.isPipelineRunning()) {
      return c.json(
        {
          error: 'A pipeline is running. Disable schedules and retry once idle.',
          code: 'pipeline_running' as const,
        },
        409,
      )
    }
    setMaintenance(true)
    try {
      const report = await migrateBackend({
        sourceDb: deps.db,
        target: parsed.data.target,
        overwrite: parsed.data.overwrite,
        isPipelineRunning: deps.isPipelineRunning,
      })
      return c.json(report, report.ok ? 200 : 422)
    } catch (err) {
      return c.json({ error: logAndSanitize(err, 'migrate-backend') }, 500)
    } finally {
      setMaintenance(false)
    }
  })

  return router
}

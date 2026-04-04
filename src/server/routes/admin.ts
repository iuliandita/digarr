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
import { mergePreferences } from '@/db/schema'
import type { HonoEnv } from '@/server/types'

export interface AdminDeps {
  db: OpsDb
  getUserById: (id: number) => Promise<{ isAdmin: boolean; preferences?: unknown } | null>
  getSettings: () => Promise<{ preferences?: unknown } | null>
  generateReasoning?: (artistName: string, genres: string[]) => Promise<string>
}

const VALID_STATUSES = new Set([
  'pending',
  'approved',
  'rejected',
  'added_to_lidarr',
  'add_failed',
  'duplicate',
])

export function adminRoutes(deps: AdminDeps) {
  const router = new Hono<HonoEnv>()

  // POST /api/admin/backup -- download backup JSON
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

  // POST /api/admin/restore -- upload and restore backup JSON
  router.post('/api/admin/restore', async (c) => {
    const force = c.req.query('force') === 'true'
    const contentType = c.req.header('content-type') ?? ''

    let backup: BackupFile
    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.formData()
        const file = form.get('file')
        if (!file || !(file instanceof File)) {
          return c.json({ error: 'No file provided' }, 400)
        }
        const text = await file.text()
        backup = JSON.parse(text)
      } else {
        backup = await c.req.json<BackupFile>()
      }
    } catch {
      return c.json({ error: 'Invalid backup file format' }, 400)
    }

    if (!backup.version || !backup.data) {
      return c.json({ error: 'Invalid backup file structure' }, 400)
    }

    const result = await restoreBackup(deps.db, backup, { force })

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

  // GET /api/admin/backup/last -- last auto-backup metadata
  router.get('/api/admin/backup/last', async (c) => {
    const status = await getPendingMigrations(deps.db)
    return c.json({ lastAutoBackup: status.lastAutoBackup })
  })

  // GET /api/admin/migrations/pending -- pending migration status
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
    const prefs = mergePreferences(user?.preferences as never)
    const statusParam = c.req.query('status') ?? 'pending'
    const statuses = statusParam.split(',').filter((s) => VALID_STATUSES.has(s))
    if (statuses.length === 0) {
      return c.json({ error: 'No valid status values provided' }, 400)
    }

    // Library genres unavailable in offline rescore -- zero the weight to avoid score drift
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

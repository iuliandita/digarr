import { Hono } from 'hono'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupFile, OpsDb } from '@/core/ops/types'
import type { HonoEnv } from '@/server/types'

export interface AdminDeps {
  db: OpsDb
}

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

  // GET /api/admin/backup/last -- last auto-backup metadata (stub, implemented in Task 6)
  router.get('/api/admin/backup/last', async (c) => {
    return c.json({ lastAutoBackup: null })
  })

  return router
}

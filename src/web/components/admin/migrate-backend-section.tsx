import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { ApiError, migrateBackendApi, testMigrateTarget } from '@/web/lib/api'
import { useI18n } from '@/web/lib/i18n'

type TargetBackend = 'pglite' | 'postgres'

type MigrateResult = {
  ok: boolean
  verified: boolean
  contentVerified: boolean
  targetBackend: string
  targetDescription: string
  tablesMigrated: Record<string, number>
  excludedTables: string[]
  mismatches: { table: string; source: number; target: number; contentDiffers?: boolean }[]
  targetEnvHint: string
}

export function MigrateBackendSection() {
  const { t } = useI18n()
  const [backend, setBackend] = useState<TargetBackend>('pglite')
  const [path, setPath] = useState('')
  const [dsn, setDsn] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [testing, setTesting] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<MigrateResult | null>(null)

  function buildTarget() {
    if (backend === 'pglite') return { backend: 'pglite' as const, path }
    return { backend: 'postgres' as const, dsn }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await testMigrateTarget(buildTarget())
      if (res.ok) {
        toast.success(
          t('admin.migrateConnectionOk').replace('{0}', res.description ?? res.backend ?? backend),
        )
      } else {
        toast.error(res.error ?? t('admin.migrateConnectionFailed'))
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String((err.data as Record<string, unknown>)?.error ?? err.message)
          : t('admin.migrateConnectionFailed')
      toast.error(msg || t('admin.migrateConnectionFailed'))
    } finally {
      setTesting(false)
    }
  }

  async function handleMigrate() {
    setMigrating(true)
    setShowConfirm(false)
    setResult(null)
    try {
      const res = await migrateBackendApi(buildTarget(), overwrite)
      setResult(res)
      const total = Object.values(res.tablesMigrated).reduce((a, b) => a + b, 0)
      const tables = Object.keys(res.tablesMigrated).length
      toast.success(
        t('admin.migrateSuccess').replace('{0}', String(total)).replace('{1}', String(tables)),
      )
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String((err.data as Record<string, unknown>)?.error ?? err.message)
          : t('admin.migrateFailed')
      toast.error(msg || t('admin.migrateFailed'))
    } finally {
      setMigrating(false)
    }
  }

  const totalRows = result ? Object.values(result.tablesMigrated).reduce((a, b) => a + b, 0) : 0
  const tableCount = result ? Object.keys(result.tablesMigrated).length : 0
  const rowMismatches = result?.mismatches.filter((m) => !m.contentDiffers) ?? []
  const contentMismatches = result?.mismatches.filter((m) => m.contentDiffers) ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('admin.migrateIntro')}</p>

      <div className="space-y-1">
        <span className="text-xs font-medium text-text">{t('admin.migrateTargetBackend')}</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-text">
            <input
              type="radio"
              name="migrateBackend"
              value="pglite"
              checked={backend === 'pglite'}
              onChange={() => setBackend('pglite')}
            />
            PGlite
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text">
            <input
              type="radio"
              name="migrateBackend"
              value="postgres"
              checked={backend === 'postgres'}
              onChange={() => setBackend('postgres')}
            />
            PostgreSQL
          </label>
        </div>
      </div>

      {backend === 'pglite' ? (
        <div className="space-y-1">
          <label htmlFor="migrate-pglite-path" className="text-xs font-medium text-text">
            {t('admin.migratePglitePath')}
          </label>
          <input
            id="migrate-pglite-path"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-surface text-text"
            placeholder="/data/pglite"
          />
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="migrate-postgres-dsn" className="text-xs font-medium text-text">
            {t('admin.migratePostgresDsn')}
          </label>
          <input
            id="migrate-postgres-dsn"
            type="password"
            value={dsn}
            onChange={(e) => setDsn(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-surface text-text"
            placeholder="postgresql://user:password@host:5432/db"
            autoComplete="new-password"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(e) => setOverwrite(e.target.checked)}
          className="rounded border-border"
        />
        {t('admin.migrateOverwrite')}
      </label>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || migrating}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-text hover:bg-surface disabled:opacity-50"
        >
          {testing ? t('admin.migrateRunning') : t('admin.migrateTestConnection')}
        </button>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={migrating || testing}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50"
        >
          {migrating ? t('admin.migrateRunning') : t('admin.migrateRun')}
        </button>
      </div>

      <p className="text-xs text-muted">{t('admin.migrateMaintenanceNote')}</p>

      {result && (
        <div className="space-y-2 p-3 rounded-md border border-border bg-surface/50">
          <p className="text-sm font-medium text-text">
            {t('admin.migrateSuccess')
              .replace('{0}', String(totalRows))
              .replace('{1}', String(tableCount))}
          </p>

          {result.excludedTables.length > 0 && (
            <p className="text-xs text-muted">
              {t('admin.migrateExcluded').replace('{0}', result.excludedTables.join(', '))}
            </p>
          )}

          {rowMismatches.length > 0 && (
            <p className="text-xs text-amber-500">
              {t('admin.migrateVerifyFailed').replace(
                '{0}',
                rowMismatches.map((m) => m.table).join(', '),
              )}
            </p>
          )}

          {contentMismatches.length > 0 && (
            <p className="text-xs text-amber-500">
              {t('admin.migrateContentMismatch').replace(
                '{0}',
                contentMismatches.map((m) => m.table).join(', '),
              )}
            </p>
          )}

          <div className="space-y-1">
            <p className="text-xs text-muted">{t('admin.migrateEnvHint')}</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-surface border border-border rounded px-2 py-1 flex-1 break-all">
                {result.targetEnvHint}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(result.targetEnvHint)}
                className="text-xs px-2 py-1 rounded border border-border hover:bg-surface"
              >
                {t('admin.migrateCopyHint')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          title={t('admin.migrateConfirmTitle')}
          message={t('admin.migrateConfirmMessage')}
          confirmLabel={t('admin.migrateRun')}
          destructive
          onConfirm={handleMigrate}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

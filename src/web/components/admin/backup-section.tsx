import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { ApiError, downloadBackup, getLastAutoBackup, restoreBackupApi } from '@/web/lib/api'
import { useI18n } from '@/web/lib/i18n'

export function BackupSection() {
  const { locale, t } = useI18n()
  const [includeCaches, setIncludeCaches] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<{
    file: File
    mismatch?: boolean
    affectedFields?: string[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const restoreInFlight = useRef(false)

  const { data: lastBackup } = useQuery({
    queryKey: ['lastAutoBackup'],
    queryFn: getLastAutoBackup,
  })

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadBackup(includeCaches)
      toast.success(t('admin.backupDownloaded'))
    } catch {
      toast.error(t('admin.backupFailed'))
    } finally {
      setDownloading(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || restoreInFlight.current) return
    setConfirmRestore({ file })
  }

  async function handleRestore() {
    if (!confirmRestore || restoreInFlight.current) return
    const { file, mismatch: force = false } = confirmRestore
    restoreInFlight.current = true
    setRestoring(true)
    setConfirmRestore(null)
    try {
      const result = await restoreBackupApi(file, force)
      if (result.encryptionMismatch && !force) {
        setConfirmRestore({ file, mismatch: true, affectedFields: result.affectedEncryptedFields })
      } else {
        const total = Object.values(result.tablesRestored).reduce((a, b) => a + b, 0)
        toast.success(
          force
            ? t('admin.restoreSummaryForce').replace('{0}', String(total))
            : t('admin.restoreSummary')
                .replace('{0}', String(total))
                .replace('{1}', String(Object.keys(result.tablesRestored).length)),
        )
        if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('; '))
        }
      }
    } catch (err: unknown) {
      const body =
        err instanceof ApiError
          ? (err.data as {
              error?: string
              affectedFields?: string[]
            } | null)
          : null
      if (
        !force &&
        err instanceof ApiError &&
        err.status === 409 &&
        body?.error === 'Encryption key mismatch'
      ) {
        setConfirmRestore({
          file,
          mismatch: true,
          affectedFields: body.affectedFields ?? [],
        })
      } else {
        toast.error(t('admin.restoreFailed'))
      }
    } finally {
      restoreInFlight.current = false
      setRestoring(false)
    }
  }

  const lastAuto = lastBackup?.lastAutoBackup

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-accent-fg hover:bg-accent/90 disabled:opacity-50"
        >
          {downloading ? t('admin.exporting') : t('admin.downloadBackup')}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={includeCaches}
            onChange={(e) => setIncludeCaches(e.target.checked)}
            className="rounded border-border"
          />
          {t('admin.includeCaches')}
        </label>
      </div>

      {lastAuto && (
        <p className="text-xs text-muted">
          {t('admin.lastAutoBackup')} {new Date(lastAuto.createdAt).toLocaleString(locale)}
        </p>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          disabled={restoring}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={restoring}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-text hover:bg-surface disabled:opacity-50"
        >
          {restoring ? t('admin.restoring') : t('admin.restoreFromBackup')}
        </button>
      </div>

      {confirmRestore && (
        <ConfirmDialog
          title={t(
            confirmRestore.mismatch ? 'admin.encryptionMismatch' : 'admin.restoreConfirmTitle',
          )}
          message={
            confirmRestore.mismatch
              ? `${t('admin.encryptionMismatchMessage')} ${
                  confirmRestore.affectedFields?.length
                    ? t('admin.encryptionMismatchAffected').replace(
                        '{0}',
                        confirmRestore.affectedFields.join(', '),
                      )
                    : t('admin.encryptionMismatchFallback')
                }`
              : t('admin.restoreConfirmMessage')
          }
          confirmLabel={t(
            confirmRestore.mismatch ? 'admin.restoreAnyway' : 'admin.restoreFromBackup',
          )}
          destructive
          onConfirm={handleRestore}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { ApiError, downloadBackup, getLastAutoBackup, restoreBackupApi } from '@/web/lib/api'
import { useI18n } from '@/web/lib/i18n'

export function BackupSection() {
  const { t } = useI18n()
  const [includeCaches, setIncludeCaches] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<{
    file: File
    mismatch?: boolean
    affectedFields?: string[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const result = await restoreBackupApi(file, false)
      if (result.encryptionMismatch) {
        setConfirmRestore({ file, mismatch: true, affectedFields: result.affectedEncryptedFields })
      } else {
        const total = Object.values(result.tablesRestored).reduce((a, b) => a + b, 0)
        toast.success(
          `Restored ${total} rows across ${Object.keys(result.tablesRestored).length} tables`,
        )
        if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('; '))
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.data as { affectedFields?: string[] }
        setConfirmRestore({
          file,
          mismatch: true,
          affectedFields: body.affectedFields ?? [],
        })
      } else {
        toast.error(t('admin.restoreFailed'))
      }
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleForceRestore() {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      const result = await restoreBackupApi(confirmRestore.file, true)
      const total = Object.values(result.tablesRestored).reduce((a, b) => a + b, 0)
      toast.success(`Restored ${total} rows. Re-enter credentials for encrypted fields.`)
    } catch {
      toast.error(t('admin.restoreFailed'))
    } finally {
      setRestoring(false)
      setConfirmRestore(null)
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
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
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
          Last auto-backup: {new Date(lastAuto.createdAt).toLocaleString()}
        </p>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-text hover:bg-surface"
        >
          {t('admin.restoreFromBackup')}
        </button>
      </div>

      {confirmRestore?.mismatch && (
        <ConfirmDialog
          title={t('admin.encryptionMismatch')}
          message={`The backup was created with a different encryption key. ${
            confirmRestore.affectedFields?.length
              ? `These fields will need re-entry: ${confirmRestore.affectedFields.join(', ')}`
              : 'Some encrypted fields may need re-entry.'
          }`}
          confirmLabel={restoring ? t('admin.restoring') : t('admin.restoreAnyway')}
          destructive
          onConfirm={handleForceRestore}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </div>
  )
}

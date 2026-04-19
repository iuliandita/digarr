import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getPendingMigrations } from '@/web/lib/api'
import { useI18n } from '@/web/lib/i18n'

export function UpgradeSection() {
  const { locale, t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['pendingMigrations'],
    queryFn: getPendingMigrations,
  })

  if (!data) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{t('admin.currentVersion')}</span>
        <span className="text-sm font-mono text-text">{data.currentVersion ?? 'none'}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{t('admin.pendingMigrations')}</span>
        <span className="text-sm text-text">
          {data.pendingCount === 0 ? (
            <span className="text-green-500">{t('admin.upToDate')}</span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-accent underline"
            >
              {data.pendingCount} pending
            </button>
          )}
        </span>
      </div>

      {expanded && data.pendingMigrations.length > 0 && (
        <ul className="text-xs font-mono text-muted space-y-0.5 pl-2">
          {data.pendingMigrations.map((m: string) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {data.lastAutoBackup && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{t('admin.lastAutoBackup')}</span>
          <span className="text-xs text-muted">
            {new Date(data.lastAutoBackup.createdAt).toLocaleString(locale)}
          </span>
        </div>
      )}
    </div>
  )
}

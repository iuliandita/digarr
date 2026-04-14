import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { getLibrarySources } from '../lib/api'
import { useI18n } from '../lib/i18n'

const STORAGE_KEY = 'digarr.firstSyncBannerDismissed'

export function LibraryFirstSyncBanner() {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  const sourcesQuery = useQuery({
    queryKey: ['library', 'sources'],
    queryFn: getLibrarySources,
    refetchInterval: 5000,
  })

  if (dismissed) return null

  const sources = sourcesQuery.data?.sources ?? []

  const isFirstSync =
    sources.length === 0 ||
    sources.some((s) => s.lastSyncStatus === 'running' && (s.lastSyncCounts?.cacheHits ?? 0) === 0)

  if (!isFirstSync) return null

  function dismiss() {
    setDismissed(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1')
    }
  }

  return (
    <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-4 relative">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted hover:opacity-70 transition-opacity"
        aria-label={t('common.dismiss')}
      >
        <X size={14} />
      </button>
      <div className="pr-6 space-y-1">
        <div className="text-sm font-semibold text-text">{t('firstSyncBanner.title')}</div>
        <div className="text-sm text-muted">{t('firstSyncBanner.body')}</div>
      </div>
    </div>
  )
}

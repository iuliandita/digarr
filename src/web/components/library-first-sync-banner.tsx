import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { getLibrarySources } from '../lib/api'
import { useI18n } from '../lib/i18n'

const STORAGE_KEY = 'digarr.firstSyncBannerDismissed'

type LibrarySources = Awaited<ReturnType<typeof getLibrarySources>>['sources']

function isFirstSync(sources: LibrarySources): boolean {
  return sources.some(
    (s) => s.lastSyncStatus === 'running' && (s.lastSyncCounts?.cacheHits ?? 0) === 0,
  )
}

export function LibraryFirstSyncBanner() {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  const sourcesQuery = useQuery({
    queryKey: ['library', 'sources'],
    queryFn: getLibrarySources,
    enabled: !dismissed,
    refetchInterval: (query) => {
      const sources = query.state.data?.sources
      return !sources || isFirstSync(sources) ? 5000 : false
    },
  })

  if (dismissed) return null

  if (!isFirstSync(sourcesQuery.data?.sources ?? [])) return null

  function dismiss() {
    setDismissed(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1')
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-4 relative">
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

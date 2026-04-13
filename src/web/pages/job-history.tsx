import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { JobRunRow } from '../components/job-run-row'
import { listJobs } from '../lib/api'
import { useI18n } from '../lib/i18n'

const PAGE_SIZE = 50

export default function JobHistoryPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n()
  const TABS = [
    { key: '', label: t('jobHistory.all') },
    { key: 'pipeline', label: t('jobHistory.pipeline') },
    { key: 'subscription', label: t('jobHistory.subscriptions') },
    { key: 'target', label: t('jobHistory.targets') },
    { key: 'library_sync', label: t('jobHistory.librarySync') },
    { key: 'quick_discover', label: t('jobHistory.quickDiscover') },
    { key: 'playlist', label: t('jobHistory.playlists') },
  ]
  const [type, setType] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', type, offset],
    queryFn: () => listJobs({ type: type || undefined, limit: PAGE_SIZE, offset }),
    staleTime: 15_000,
  })

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-6xl space-y-4 p-6'}>
      <div>
        <h2
          className={
            embedded
              ? 'text-sm font-semibold text-text uppercase tracking-wide'
              : 'text-xl font-bold text-text'
          }
        >
          {t('jobHistory.title')}
        </h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setType(tab.key)
              setOffset(0)
            }}
            className={`rounded px-3 py-1 text-sm ${
              type === tab.key
                ? 'bg-accent text-white'
                : 'bg-surface-alt text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {isLoading ? (
          <div className="p-8 text-center text-muted">{t('common.loading')}</div>
        ) : !data?.items.length ? (
          <div className="p-8 text-center text-muted">{t('jobHistory.empty')}</div>
        ) : (
          data.items.map((job) => <JobRunRow key={job.id} job={job} />)
        )}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {t('jobHistory.showing')} {offset + 1}-{Math.min(offset + PAGE_SIZE, data.total)}{' '}
            {t('jobHistory.of')} {data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded bg-surface-alt px-3 py-1 disabled:opacity-50"
            >
              {t('common.previous')}
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className="rounded bg-surface-alt px-3 py-1 disabled:opacity-50"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

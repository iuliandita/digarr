import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { JobRunRow } from '../components/job-run-row'
import { listJobs } from '../lib/api'

const TABS = [
  { key: '', label: 'All' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'subscription', label: 'Subscriptions' },
  { key: 'target', label: 'Targets' },
  { key: 'quick_discover', label: 'Quick Discover' },
  { key: 'playlist', label: 'Playlists' },
]

const PAGE_SIZE = 50

export default function JobHistoryPage() {
  const [type, setType] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', type, offset],
    queryFn: () => listJobs({ type: type || undefined, limit: PAGE_SIZE, offset }),
    staleTime: 15_000,
  })

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-bold text-text">Job History</h1>

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
          <div className="p-8 text-center text-muted">Loading...</div>
        ) : !data?.items.length ? (
          <div className="p-8 text-center text-muted">No jobs found.</div>
        ) : (
          data.items.map((job) => <JobRunRow key={job.id} job={job} />)
        )}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded bg-surface-alt px-3 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className="rounded bg-surface-alt px-3 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { Sparkles } from 'lucide-react'
import {
  type FocusEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import { shouldIgnoreShortcut } from '../hooks/use-keyboard-shortcuts'
import { moodDiscover } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { type MoodAddFailure, moodAddQueue } from '../lib/mood-add-queue'

export function MoodPromptBar({
  existingArtistNames,
  onQueued,
}: {
  existingArtistNames: Set<string>
  onQueued: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{
    artistName: string
    reasoning: string
    confidence: number
    genres: string[]
    inLibrary?: boolean
  }> | null>(null)
  const [loading, setLoading] = useState(false)
  const addStatuses = useSyncExternalStore(moodAddQueue.subscribe, moodAddQueue.getSnapshot)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusOnOpen = useRef(false)
  const visible = expanded || query !== '' || results !== null || loading

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || shouldIgnoreShortcut(e)) return
      e.preventDefault()
      focusOnOpen.current = true
      setExpanded(true)
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (visible && focusOnOpen.current) {
      focusOnOpen.current = false
      inputRef.current?.focus()
    }
  }, [visible])

  function handleBlur(e: FocusEvent<HTMLFormElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false)
  }

  function expand() {
    focusOnOpen.current = true
    setExpanded(true)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!query.trim() || loading) return
    setLoading(true)
    try {
      const res = await moodDiscover(query.trim())
      setResults(res.results)
    } catch (err) {
      const detail = err instanceof Error ? err.message.trim() : ''
      // ApiError.message falls back to "API Error <status>" - still worth showing.
      toast.error(detail ? `${t('discover.moodFailed')}: ${detail}` : t('discover.moodFailed'))
    } finally {
      setLoading(false)
    }
  }

  function handleAddToQueue(artistName: string) {
    moodAddQueue.enqueue(artistName, {
      onAdded: () => {
        toast.success(t('discover.moodAddedSuccess').replace('{0}', artistName))
        // Seed artist is stored async on the backend - poll for it to appear
        setTimeout(onQueued, 2000)
        setTimeout(onQueued, 5000)
      },
      onFailed: (reason, err) => toast.error(failureMessage(artistName, reason, err)),
    })
  }

  function failureMessage(artistName: string, reason: MoodAddFailure, err: unknown) {
    if (reason === 'rate-limited')
      return t('discover.moodAddRateLimited').replace('{0}', artistName)
    if (reason === 'pipeline-running') {
      return t('discover.moodAddPipelineRunning').replace('{0}', artistName)
    }
    const base = t('discover.moodAddFailed').replace('{0}', artistName)
    const detail = err instanceof Error ? err.message.trim() : ''
    return detail ? `${base}: ${detail}` : base
  }

  if (!visible) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={expand}
          aria-keyshortcuts="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded hover:text-text hover:border-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <Sparkles size={14} aria-hidden="true" />
          {t('discover.moodOpen')}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4">
      <form onSubmit={handleSubmit} onBlur={handleBlur} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('discover.moodPlaceholder')}
          maxLength={500}
          className="flex-1 bg-surface border border-border rounded px-3 py-1.5 text-sm text-text placeholder:text-muted/50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 bg-accent text-accent-fg rounded text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {loading ? t('discover.discovering') : t('discover.discoverButton')}
        </button>
      </form>
      {results && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text">
              {t('discover.moodResults')} ({results.length})
            </h3>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="text-xs text-muted hover:text-text"
            >
              {t('common.clear')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {results.map((r) => (
              <div key={r.artistName} className="bg-surface border border-border rounded p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-text">{r.artistName}</div>
                    <p className="text-xs text-muted mt-1 line-clamp-2">{r.reasoning}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.genres.slice(0, 3).map((g) => (
                        <span
                          key={g}
                          className="text-micro px-1.5 py-0.5 bg-bg border border-border rounded text-muted"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {r.inLibrary ? (
                      <span className="text-micro text-muted px-2 py-1 bg-bg border border-border rounded">
                        {t('discover.inLibrary')}
                      </span>
                    ) : existingArtistNames.has(r.artistName.toLowerCase()) ? (
                      <span className="text-micro text-muted px-2 py-1 bg-bg border border-border rounded">
                        {t('discover.pendingReview')}
                      </span>
                    ) : addStatuses.get(r.artistName) === 'added' ? (
                      <span className="text-micro text-approve px-2 py-1 bg-approve/10 border border-approve/20 rounded">
                        {t('discover.addedToQueue')}
                      </span>
                    ) : addStatuses.get(r.artistName) === 'sending' ? (
                      <span className="text-micro text-muted px-2 py-1 bg-bg border border-border rounded">
                        {t('discover.discovering')}
                      </span>
                    ) : addStatuses.get(r.artistName) === 'queued' ? (
                      <span className="text-micro text-muted px-2 py-1 bg-bg border border-dashed border-border rounded">
                        {t('discover.moodAddQueued')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddToQueue(r.artistName)}
                        className="text-micro px-2 py-1 bg-accent/5 text-accent-text border border-accent/20 rounded hover:bg-accent/20 transition-colors"
                      >
                        {t('discover.addDiscover')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

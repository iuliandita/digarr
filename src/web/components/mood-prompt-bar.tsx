import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { moodDiscover, quickDiscover } from '../lib/api'

export function MoodPromptBar({
  existingArtistNames,
  onQueued,
}: {
  existingArtistNames: Set<string>
  onQueued: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{
    artistName: string
    reasoning: string
    confidence: number
    genres: string[]
    inLibrary?: boolean
  }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [queued, setQueued] = useState<Set<string>>(new Set())

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!query.trim() || loading) return
    setLoading(true)
    try {
      const res = await moodDiscover(query.trim())
      setResults(res.results)
    } catch {
      toast.error('Mood discovery failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddToQueue(artistName: string) {
    setQueued((prev) => new Set([...prev, artistName]))
    try {
      await quickDiscover(artistName)
      toast.success(`Added "${artistName}" to recommendations`)
      onQueued()
    } catch {
      toast.error(`Failed to add "${artistName}"`)
      setQueued((prev) => {
        const next = new Set(prev)
        next.delete(artistName)
        return next
      })
    }
  }

  return (
    <div className="mb-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="rainy day jazz, upbeat 90s pop, dark ambient..."
          maxLength={500}
          className="flex-1 bg-surface border border-border rounded px-3 py-1.5 text-sm text-text placeholder:text-muted/50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 bg-accent text-accent-fg rounded text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {loading ? 'Discovering...' : 'Discover'}
        </button>
      </form>
      {results && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text">Mood results ({results.length})</h3>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="text-xs text-muted hover:text-text"
            >
              Clear
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
                          className="text-[10px] px-1.5 py-0.5 bg-bg border border-border rounded text-muted"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {r.inLibrary ? (
                      <span className="text-[10px] text-muted px-2 py-1 bg-bg border border-border rounded">
                        In library
                      </span>
                    ) : existingArtistNames.has(r.artistName.toLowerCase()) ? (
                      <span className="text-[10px] text-muted px-2 py-1 bg-bg border border-border rounded">
                        Pending review
                      </span>
                    ) : queued.has(r.artistName) ? (
                      <span className="text-[10px] text-approve px-2 py-1 bg-approve/10 border border-approve/20 rounded">
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddToQueue(r.artistName)}
                        className="text-[10px] px-2 py-1 bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors"
                      >
                        + Discover
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

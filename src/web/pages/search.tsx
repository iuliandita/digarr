import { useQuery } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { SearchResultCard } from '../components/search-result-card'
import { getSearchSources, searchArtists } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

// Source filter config

const SOURCE_ORDER = ['spotify', 'deezer', 'musicbrainz', 'tidal', 'bandcamp'] as const
type SourceId = (typeof SOURCE_ORDER)[number]

const SOURCE_STYLES = {
  spotify: {
    label: 'Spotify',
    active: 'bg-green-500/20 text-green-400 border-green-500/40',
    defaultAvailable: false,
  },
  deezer: {
    label: 'Deezer',
    active: 'bg-pink-500/20 text-pink-400 border-pink-500/40',
    defaultAvailable: true,
  },
  musicbrainz: {
    label: 'MusicBrainz',
    active: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    defaultAvailable: true,
  },
  tidal: {
    label: 'TIDAL',
    active: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
    defaultAvailable: false,
  },
  bandcamp: {
    label: 'Bandcamp',
    active: 'bg-teal-500/20 text-teal-400 border-teal-500/40',
    defaultAvailable: true,
  },
} as const

// SearchPage

export function SearchPage() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [activeSources, setActiveSources] = useState<SourceId[]>([])
  const { data: sourceData } = useQuery({
    queryKey: ['search-sources'],
    queryFn: getSearchSources,
    staleTime: 300_000,
  })

  const sourceState = new Map(sourceData?.sources.map((source) => [source.id, source]))
  const renderedSources = SOURCE_ORDER.map((id) => {
    const known = sourceState.get(id)
    const style = SOURCE_STYLES[id]
    return {
      id,
      label: known?.label ?? style.label,
      active: style.active,
      available: known?.available ?? style.defaultAvailable,
      stability: known?.stability,
      reason: known?.reason,
    }
  })
  const availableSourceIds = renderedSources
    .filter((source) => source.available)
    .map((source) => source.id)
  const availableSourceSet = new Set(availableSourceIds)
  const disabledSources = renderedSources.filter((source) => !source.available && source.reason)
  const effectiveActiveSources = activeSources.filter((id) => availableSourceSet.has(id))

  function toggleSource(id: SourceId) {
    if (!availableSourceSet.has(id)) return
    setActiveSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['search', deferredQuery, effectiveActiveSources],
    queryFn: () =>
      searchArtists(
        deferredQuery,
        effectiveActiveSources.length ? effectiveActiveSources : undefined,
      ),
    enabled: deferredQuery.length >= 2,
    staleTime: 30_000,
  })

  const results = data?.results ?? []
  const showResults = deferredQuery.length >= 2
  const isPending = query !== deferredQuery || isLoading

  const { t } = useI18n()

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-text mb-1">{t('search.title')}</h1>
        <p className="text-sm text-muted">{t('search.subtitle')}</p>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchIcon
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          type="search"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-surface border border-border rounded-lg text-text placeholder:text-muted text-sm focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Source filter toggles */}
      <div className="flex flex-wrap gap-2">
        {renderedSources.map((s) => {
          const isActive = effectiveActiveSources.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              disabled={!s.available}
              onClick={() => toggleSource(s.id)}
              title={!s.available ? s.reason : undefined}
              className={cn(
                'text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                isActive
                  ? s.active
                  : s.available
                    ? 'bg-surface border-border text-muted hover:text-text hover:border-accent/40'
                    : 'bg-surface border-border text-muted/60 opacity-50 cursor-not-allowed',
              )}
            >
              {s.label}
              {s.stability === 'experimental' && (
                <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-600">
                  {t('search.experimental')}
                </span>
              )}
            </button>
          )
        })}
        {activeSources.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveSources([])}
            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted hover:text-text transition-colors"
          >
            {t('search.clearFilters')}
          </button>
        )}
      </div>

      {disabledSources.length > 0 && (
        <p className="text-xs text-muted">
          {disabledSources
            .map((source) => `${source.label}: ${t(source.reason as Parameters<typeof t>[0])}`)
            .join(' ')}
        </p>
      )}

      {/* Results area */}
      {!showResults && (
        <p className="text-sm text-muted text-center pt-8">{t('search.minChars')}</p>
      )}

      {showResults && isPending && (
        <div className="grid gap-2">
          {['search-skeleton-1', 'search-skeleton-2', 'search-skeleton-3'].map((key) => (
            <div
              key={key}
              className="bg-surface border border-border rounded-lg p-3 h-20 animate-pulse"
            />
          ))}
        </div>
      )}

      {showResults && !isPending && isError && (
        <p className="text-sm text-reject text-center pt-8">{t('search.failed')}</p>
      )}

      {showResults && !isPending && !isError && results.length === 0 && (
        <p className="text-sm text-muted text-center pt-8">
          {t('search.noResultsFor')} &ldquo;{deferredQuery}&rdquo;
        </p>
      )}

      {showResults && !isPending && results.length > 0 && (
        <div className="grid gap-2">
          {results.map((result) => (
            <SearchResultCard key={result.mbid ?? result.name} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}

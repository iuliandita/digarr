import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { GenreInfo } from '../../core/genre/types'
import { GenreGrid } from '../components/genre-grid'
import { Hint } from '../components/hint'
import { Input } from '../components/ui/input'
import { usePullToRefresh } from '../hooks/use-pull-to-refresh'
import { getCurrentUser, getGenres, searchGenres, seedGenres } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function GenresPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  // Seeding genres calls POST /api/v1/genres/seed, which is admin-gated server-side.
  // Hide the trigger from non-admins so they never see a control that always 403s.
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const isAdmin = currentUser?.isAdmin ?? false
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [seeding, setSeeding] = useState(false)
  const {
    pullY,
    pullThreshold: PULL_THRESHOLD,
    handlers: pullHandlers,
  } = usePullToRefresh(() => {
    queryClient.invalidateQueries({ queryKey: ['genres'] })
    toast.info(t('common.refreshing'))
  })

  // Debounce search input ~300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const isSearching = debouncedQuery.length >= 2

  const { data: libraryGenres = [], isLoading: libraryLoading } = useQuery<GenreInfo[]>({
    queryKey: ['genres', 'library'],
    queryFn: getGenres,
    enabled: !isSearching,
  })

  const { data: searchResults = [], isLoading: searchLoading } = useQuery<GenreInfo[]>({
    queryKey: ['genres', 'search', debouncedQuery],
    queryFn: () => searchGenres(debouncedQuery),
    enabled: isSearching,
  })

  const genres = isSearching ? searchResults : libraryGenres
  const loading = isSearching ? searchLoading : libraryLoading
  const isEmpty = !loading && libraryGenres.length === 0 && !isSearching

  async function handleSeed() {
    setSeeding(true)
    try {
      const result = await seedGenres()
      toast.success(result.message ?? t('genres.seedStarted'))
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['genres'] })
      }, 3000)
    } catch {
      toast.error(t('genres.seedFailed'))
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto pb-24 md:pb-6" {...pullHandlers}>
      {/* Pull-to-refresh indicator */}
      {pullY > 0 && (
        <div
          className="flex items-center justify-center text-xs text-muted transition-all"
          style={{ height: `${Math.min(pullY, PULL_THRESHOLD + 20)}px` }}
          aria-hidden="true"
        >
          {pullY >= PULL_THRESHOLD ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
        </div>
      )}
      {/* Header + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-text">{t('genres.title')}</h1>
          <p className="text-xs text-muted mt-0.5">{t('genres.subtitle')}</p>
        </div>
        <Input
          type="search"
          placeholder={t('genres.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:w-64"
        />
      </div>

      <Hint id="genres-browse-tip" type="inline">
        {t('genres.browseTip')}
      </Hint>

      {/* Empty state with seed button */}
      {isEmpty ? (
        <div className="py-16 text-center space-y-4">
          <p className="text-muted text-sm">{t('genres.empty')}</p>
          {isAdmin && (
            <button
              type="button"
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {seeding ? t('genres.seeding') : t('genres.seedFromLibrary')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {isSearching ? (
            <p className="text-xs text-muted">
              {searchLoading
                ? t('common.searching')
                : `${searchResults.length} ${
                    searchResults.length === 1
                      ? t('genres.resultSingular')
                      : t('genres.resultPlural')
                  } ${t('genres.forQuery')} "${debouncedQuery}"`}
            </p>
          ) : (
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
                {t('genres.libraryGenres')}
              </h2>
              {!loading && (
                <span className="text-xs text-muted">
                  {libraryGenres.length}{' '}
                  {libraryGenres.length === 1 ? t('genres.genreSingular') : t('genres.genrePlural')}
                </span>
              )}
            </div>
          )}
          <GenreGrid genres={genres} loading={loading} />
        </div>
      )}

      {/* FAB: Seed Genres - mobile only, above bottom nav. Admin-only (see above). */}
      {isAdmin && (
        <button
          type="button"
          onClick={handleSeed}
          disabled={seeding}
          aria-label={seeding ? t('genres.seeding') : t('genres.seed')}
          title={seeding ? t('genres.seeding') : t('genres.seedFromLibrary')}
          className="md:hidden fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full bg-accent text-accent-fg shadow-lg flex items-center justify-center hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {seeding ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 animate-spin"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}

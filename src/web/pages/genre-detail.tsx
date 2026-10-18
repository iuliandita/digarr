import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { GenreInfo } from '../../core/genre/types'
import { ArtistThumb } from '../components/artist-thumb'
import { Hint } from '../components/hint'
import { Button } from '../components/ui/button'
import { PageHeader } from '../components/ui/page-header'
import { Skeleton } from '../components/ui/skeleton'
import type { GenreArtist, LibraryArtist } from '../lib/api'
import { getGenre, getGenreArtists, quickDiscover, warmArtists } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { usePreviewContext } from '../lib/preview-context'

type GenreDetail = GenreInfo & { subGenres: GenreInfo[]; libraryArtists: LibraryArtist[] }

type DetailTab = 'library' | 'recommended' | 'trending' | 'deep_cuts'

// Library artist card

function LibraryArtistCard({ artist }: { artist: LibraryArtist }) {
  const genres = artist.genres ?? []
  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
      <ArtistThumb name={artist.name} imageUrl={artist.imageUrl} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">{artist.name}</p>
        {artist.disambiguation && (
          <p className="text-xs text-muted truncate">{artist.disambiguation}</p>
        )}
        {genres.length > 0 && (
          <p className="text-micro text-muted truncate mt-0.5">{genres.slice(0, 3).join(', ')}</p>
        )}
      </div>
    </div>
  )
}

// Genre artist card (for recommendation-backed tabs)

function GenreArtistCard({ artist }: { artist: GenreArtist }) {
  const { t } = useI18n()
  const [discovering, setDiscovering] = useState(false)
  const [queued, setQueued] = useState(false)
  const genres = artist.genres ?? []
  const preview = usePreviewContext()
  const isPlaying = preview.currentMbid === artist.mbid && preview.playing
  const canPreview = preview.hasPreview(artist.streamingUrls ?? null)

  async function handleQuickDiscover() {
    setDiscovering(true)
    try {
      await quickDiscover(artist.name)
      setQueued(true)
    } catch {
      // ignore
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
      <ArtistThumb name={artist.name} imageUrl={artist.imageUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text truncate">{artist.name}</p>
          <span className="shrink-0 text-micro font-semibold px-1.5 py-0.5 rounded bg-accent/5 text-accent-text">
            {(artist.score * 100).toFixed(0)}
          </span>
        </div>
        {artist.aiReasoning && (
          <p className="text-xs text-muted truncate mt-0.5">{artist.aiReasoning}</p>
        )}
        {genres.length > 0 && (
          <p className="text-micro text-muted truncate mt-0.5">{genres.slice(0, 3).join(', ')}</p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {canPreview && (
          <button
            type="button"
            onClick={() =>
              isPlaying
                ? preview.stop()
                : preview.play(artist.mbid, artist.name, artist.streamingUrls ?? null)
            }
            className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-muted hover:text-accent-text hover:border-accent/60 transition-colors"
            aria-label={
              isPlaying ? t('recommendation.stopPreview') : t('recommendation.playPreview')
            }
          >
            {isPlaying ? (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="1" y="1" width="3" height="8" />
                <rect x="6" y="1" width="3" height="8" />
              </svg>
            ) : (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M2 1l7 4-7 4V1z" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          disabled={discovering || queued}
          onClick={handleQuickDiscover}
          className="px-2 py-1 text-xs rounded border border-border text-muted hover:text-text hover:border-accent/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {queued
            ? t('genreDetail.inQueue')
            : discovering
              ? t('common.loadingEllipsis')
              : t('genreDetail.queue')}
        </button>
      </div>
    </div>
  )
}

// Tab content grid skeleton

function TabSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {(['a', 'b', 'c', 'd', 'e', 'f'] as const).map((k) => (
        <Skeleton key={k} className="h-16 rounded-lg" />
      ))}
    </div>
  )
}

// Skeleton loader

function DetailSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <Skeleton className="h-4 w-20" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-full" />
        ))}
      </div>
    </div>
  )
}

// Genre detail page

export function GenreDetailPage() {
  const { t } = useI18n()
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<DetailTab>('library')
  const { data, isLoading, error } = useQuery<GenreDetail>({
    queryKey: ['genres', 'detail', slug],
    queryFn: () => getGenre(slug ?? ''),
    enabled: Boolean(slug),
  })

  const isNonLibraryTab = activeTab !== 'library'

  const { data: genreArtistsData, isLoading: isGenreArtistsLoading } = useQuery({
    queryKey: ['genres', 'artists', slug, activeTab],
    queryFn: () => getGenreArtists(slug ?? '', activeTab),
    enabled: Boolean(slug) && isNonLibraryTab,
  })

  const libraryArtists = data?.libraryArtists
  const tabs: { id: DetailTab; label: string; description: string }[] = [
    {
      id: 'library',
      label: t('genreDetail.tabLibrary'),
      description: t('genreDetail.tabLibraryDescription'),
    },
    {
      id: 'recommended',
      label: t('genreDetail.tabRecommended'),
      description: t('genreDetail.tabRecommendedDescription'),
    },
    {
      id: 'trending',
      label: t('genreDetail.tabTrending'),
      description: t('genreDetail.tabTrendingDescription'),
    },
    {
      id: 'deep_cuts',
      label: t('genreDetail.tabDeepCuts'),
      description: t('genreDetail.tabDeepCutsDescription'),
    },
  ]
  const tabEmptyLabels: Record<DetailTab, string> = {
    library: t('genreDetail.emptyLibrary'),
    recommended: t('genreDetail.emptyRecommended'),
    trending: t('genreDetail.emptyTrending'),
    deep_cuts: t('genreDetail.emptyDeepCuts'),
  }

  useEffect(() => {
    if (libraryArtists && libraryArtists.length > 0) {
      const mbids = libraryArtists.filter((a) => a.mbid).map((a) => a.mbid)
      if (mbids.length > 0) {
        warmArtists(mbids).catch(() => {}) // Fire-and-forget
      }
    }
  }, [libraryArtists])

  if (isLoading) return <DetailSkeleton />

  if (error || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/genres')}
          className="text-sm text-muted hover:text-text transition-colors"
        >
          &larr; {t('genreDetail.backToGenres')}
        </button>
        <div className="py-16 text-center">
          <p className="text-muted text-sm">{t('genreDetail.notFound')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back nav */}
      <button
        type="button"
        onClick={() => navigate('/genres')}
        className="text-sm text-muted hover:text-text transition-colors"
      >
        &larr; {t('genreDetail.backToGenres')}
      </button>

      <PageHeader
        title={data.name}
        description={`${data.libraryArtists.length} ${
          data.libraryArtists.length === 1
            ? t('genreDetail.artistSingular')
            : t('genreDetail.artistPlural')
        } ${t('genreDetail.inYourLibrary')}`}
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(`/discovery-modes?genre=${encodeURIComponent(data.name)}`)}
          >
            {t('genreDetail.createSubscription')}
          </Button>
        }
      />

      {/* Sub-genres */}
      {data.subGenres.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wide font-semibold">
            {t('genreDetail.subGenres')}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.subGenres.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => navigate(`/genres/${sub.slug}`)}
                className="px-3 py-1 bg-surface border border-border rounded-full text-sm text-muted hover:text-text hover:border-accent/60 transition-colors"
              >
                {sub.name}
                {sub.artistCount > 0 && (
                  <span className="ml-1.5 text-xs opacity-60">{sub.artistCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted -mt-2">
          {tabs.find((tab) => tab.id === activeTab)?.description}
        </p>

        {isNonLibraryTab && (
          <Hint id="genre-detail-queue-tip" type="inline">
            {t('genreDetail.queueHint')}
          </Hint>
        )}

        {/* Tab content */}
        {activeTab === 'library' ? (
          data.libraryArtists.length === 0 ? (
            <div className="py-12 text-center bg-surface border border-border rounded-lg">
              <p className="text-muted text-sm">{tabEmptyLabels.library}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                {data.libraryArtists.length}{' '}
                {data.libraryArtists.length === 1
                  ? t('genreDetail.artistSingular')
                  : t('genreDetail.artistPlural')}{' '}
                {t('genreDetail.inYourLibrary')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.libraryArtists.map((artist) => (
                  <LibraryArtistCard key={artist.id} artist={artist} />
                ))}
              </div>
            </div>
          )
        ) : isGenreArtistsLoading ? (
          <TabSkeleton />
        ) : !genreArtistsData?.artists || genreArtistsData.artists.length === 0 ? (
          <div className="py-12 text-center bg-surface border border-border rounded-lg">
            <p className="text-muted text-sm">{tabEmptyLabels[activeTab]}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {genreArtistsData.artists.length}{' '}
              {genreArtistsData.artists.length === 1
                ? t('genreDetail.artistSingular')
                : t('genreDetail.artistPlural')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {genreArtistsData.artists.map((artist) => (
                <GenreArtistCard key={artist.mbid} artist={artist} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { GenreInfo } from '../../core/genre/types'
import { ArtistThumb } from '../components/artist-thumb'
import { Hint } from '../components/hint'
import { Skeleton } from '../components/ui/skeleton'
import type { GenreArtist, LibraryArtist } from '../lib/api'
import { getGenre, getGenreArtists, quickDiscover, warmArtists } from '../lib/api'
import { usePreviewContext } from '../lib/preview-context'

type GenreDetail = GenreInfo & { subGenres: GenreInfo[]; libraryArtists: LibraryArtist[] }

type DetailTab = 'library' | 'recommended' | 'trending' | 'deep_cuts'

const TABS: { id: DetailTab; label: string; description: string }[] = [
  { id: 'library', label: 'In Your Library', description: 'Artists already in your music library' },
  {
    id: 'recommended',
    label: 'Recommended',
    description: 'Artists you approved that match this genre',
  },
  {
    id: 'trending',
    label: 'Trending',
    description: 'Recently discovered artists in this genre (last 30 days)',
  },
  {
    id: 'deep_cuts',
    label: 'Deep Cuts',
    description: 'Hidden gems -- niche artists with low popularity',
  },
]

const TAB_EMPTY_LABELS: Record<DetailTab, string> = {
  library: 'No artists in your library for this genre.',
  recommended: 'No recommended artists yet. Run a scan and approve some recommendations first.',
  trending: 'No recent discoveries in this genre. Run a scan to find new artists.',
  deep_cuts:
    'No deep cuts found. These appear after scanning -- artists with low popularity or few genre tags.',
}

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
          <span className="shrink-0 text-micro font-semibold px-1.5 py-0.5 rounded bg-accent/20 text-accent">
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
            className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-muted hover:text-accent hover:border-accent/60 transition-colors"
            aria-label={isPlaying ? 'Stop preview' : 'Play preview'}
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
          {queued ? 'In Queue' : discovering ? '...' : '+ Queue'}
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
          &larr; Back to Genres
        </button>
        <div className="py-16 text-center">
          <p className="text-muted text-sm">Genre not found.</p>
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
        &larr; Back to Genres
      </button>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-text">{data.name}</h1>
        <p className="text-sm text-muted mt-1">
          {data.libraryArtists.length} artist{data.libraryArtists.length !== 1 ? 's' : ''} in your
          library
        </p>
      </div>

      {/* Sub-genres */}
      {data.subGenres.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wide font-semibold">Sub-genres</p>
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
          {TABS.map((tab) => (
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
          {TABS.find((t) => t.id === activeTab)?.description}
        </p>

        {isNonLibraryTab && (
          <Hint id="genre-detail-queue-tip" type="inline">
            Use the + Queue button to add artists to your recommendation queue for review on the
            Discover page.
          </Hint>
        )}

        {/* Tab content */}
        {activeTab === 'library' ? (
          data.libraryArtists.length === 0 ? (
            <div className="py-12 text-center bg-surface border border-border rounded-lg">
              <p className="text-muted text-sm">{TAB_EMPTY_LABELS.library}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                {data.libraryArtists.length} artist{data.libraryArtists.length !== 1 ? 's' : ''} in
                your library
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
            <p className="text-muted text-sm">{TAB_EMPTY_LABELS[activeTab]}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">{genreArtistsData.artists.length} artists</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {genreArtistsData.artists.map((artist) => (
                <GenreArtistCard key={artist.mbid} artist={artist} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create subscription */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => navigate(`/subscriptions?genre=${encodeURIComponent(data.name)}`)}
          className="px-4 py-2 bg-surface border border-border rounded-md text-sm text-muted hover:text-text hover:border-accent/60 transition-colors"
        >
          Create Subscription
        </button>
      </div>
    </div>
  )
}

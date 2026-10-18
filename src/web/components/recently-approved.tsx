import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAlbums } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { cn, hueFromName } from '../lib/utils'
import { Skeleton } from './ui/skeleton'

// RecentlyApproved

type RecentlyApprovedProps = {
  recs: Array<{
    id: number
    artist: { name: string; mbid?: string; imageUrl?: string | null; genres?: string[] | null }
  }>
  loading: boolean
  columns: number
  count: number
  /** Applied to the empty state so it can stretch to a paired card's height */
  emptyClassName?: string
}

function Tile({ name, mbid, imageUrl }: { name: string; mbid?: string; imageUrl?: string | null }) {
  const [imgError, setImgError] = useState(false)
  const [coverError, setCoverError] = useState(false)
  const hue = hueFromName(name)

  // Fetch album data for cover fallback when no artist image
  const needsFallback = !imageUrl || imgError
  const { data: albumData, isLoading: albumLoading } = useQuery({
    queryKey: ['tile-albums', mbid],
    queryFn: () => {
      if (!mbid) {
        throw new Error('Expected mbid for album fallback')
      }
      return getAlbums(mbid)
    },
    enabled: needsFallback && !!mbid,
    staleTime: 5 * 60_000,
  })

  const firstAlbumId = albumData?.find((a: { type: string }) => a.type === 'Album')?.id
  const coverUrl = firstAlbumId
    ? `https://coverartarchive.org/release-group/${firstAlbumId}/front-500`
    : null

  const displayUrl = (!imgError && imageUrl) || (!coverError && coverUrl)
  const showShimmer = needsFallback && albumLoading

  return (
    <Link to="/discover" className="aspect-square rounded-lg overflow-hidden relative group block">
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => {
            if (displayUrl === imageUrl) setImgError(true)
            else setCoverError(true)
          }}
        />
      ) : showShimmer ? (
        <div
          className="w-full h-full animate-pulse"
          style={{ background: `hsl(${hue}, 30%, 30%)` }}
        />
      ) : (
        <div className="w-full h-full" style={{ background: `hsl(${hue}, 40%, 45%)` }} />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
        <p className="text-white text-xs font-medium truncate">{name}</p>
      </div>
    </Link>
  )
}

export function RecentlyApproved({
  recs,
  loading,
  columns,
  count,
  emptyClassName,
}: RecentlyApprovedProps) {
  const { t } = useI18n()
  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
  if (loading) {
    return (
      <div className="grid gap-1.5" style={gridStyle}>
        {Array.from({ length: count }, (_, slot) => `slot-${slot}`).map((key) => (
          <Skeleton key={key} className="aspect-square rounded-lg" />
        ))}
      </div>
    )
  }

  if (recs.length === 0) {
    return (
      <p
        className={cn(
          'rounded-lg border border-border bg-bg p-4 text-sm text-muted',
          emptyClassName,
        )}
      >
        {t('dashboard.noRecentlyApproved')}
      </p>
    )
  }

  return (
    <div className="grid gap-1.5" style={gridStyle}>
      {recs.slice(0, count).map((rec) => (
        <Tile
          key={rec.id}
          name={rec.artist.name}
          mbid={rec.artist.mbid}
          imageUrl={rec.artist.imageUrl}
        />
      ))}
    </div>
  )
}

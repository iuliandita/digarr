import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAlbums } from '../lib/api'
import { hueFromName } from '../lib/utils'
import { Skeleton } from './ui/skeleton'

// RecentlyApproved

type RecentlyApprovedProps = {
  recs: Array<{
    id: number
    artist: { name: string; mbid?: string; imageUrl?: string | null; genres?: string[] | null }
  }>
  loading: boolean
}

const SLOTS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const

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

export function RecentlyApproved({ recs, loading }: RecentlyApprovedProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {SLOTS.map((key) => (
          <Skeleton key={key} className="aspect-square rounded-lg" />
        ))}
      </div>
    )
  }

  if (recs.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-1.5 min-h-[200px]">
        {SLOTS.map((key) => (
          <div key={key} className="aspect-square rounded-lg bg-bg border border-border" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {recs.slice(0, 9).map((rec) => (
        <Tile
          key={rec.id}
          name={rec.artist.name}
          mbid={rec.artist.mbid}
          imageUrl={rec.artist.imageUrl}
        />
      ))}
      {SLOTS.slice(recs.length).map((key) => (
        <div key={key} className="aspect-square rounded-lg bg-bg border border-border" />
      ))}
    </div>
  )
}

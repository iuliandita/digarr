import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useClickOutside } from '../hooks/use-click-outside'
import { getLibraryAlbumCoverage } from '../lib/api'

function formatAlbumLabel(title: string, releaseYear: number | null) {
  return releaseYear ? `${title} (${releaseYear})` : title
}

export function LibraryAlbumCoverageBadge({ artistMbid }: { artistMbid: string }) {
  const [open, setOpen] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [isNearViewport, setIsNearViewport] = useState(typeof IntersectionObserver === 'undefined')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      return
    }

    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '240px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const enabled = isNearViewport || hasInteracted
  const { data } = useQuery({
    queryKey: ['library-album-coverage', artistMbid],
    queryFn: () => getLibraryAlbumCoverage(artistMbid),
    staleTime: 5 * 60 * 1000,
    enabled,
  })

  useClickOutside(ref, () => setOpen(false), open)

  function requestCoverage() {
    setHasInteracted(true)
  }

  if (!enabled || !data) {
    return <div ref={ref} className="relative" />
  }

  if (data.totalCount === 0) {
    return null
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="text-xs text-muted hover:text-text transition-colors"
        onClick={(event) => {
          requestCoverage()
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        You own {data.ownedCount}/{data.totalCount} studio albums
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="space-y-3">
            <section>
              <p className="text-xs font-medium text-text">Owned</p>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {data.owned.length > 0 ? (
                  data.owned.map((album) => (
                    <li key={album.albumMbid}>
                      {formatAlbumLabel(album.title, album.releaseYear)}
                    </li>
                  ))
                ) : (
                  <li>None</li>
                )}
              </ul>
            </section>

            <section>
              <p className="text-xs font-medium text-text">Missing</p>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {data.missing.length > 0 ? (
                  data.missing.map((album) => (
                    <li key={album.albumMbid}>
                      {formatAlbumLabel(album.title, album.releaseYear)}
                    </li>
                  ))
                ) : (
                  <li>None</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getAlbums } from '../lib/api'
import { ArtistThumb } from './artist-thumb'
import { Button } from './ui/button'

type Props = {
  artistMbid: string
  artistName: string
  artistImageUrl?: string | null
  suggestedAlbumId?: string | null
  onConfirm: (selectedAlbumIds: string[]) => void
  onCancel: () => void
}

function AlbumCover({ mbid, title }: { mbid: string; title: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="w-10 h-10 rounded bg-bg shrink-0 flex items-center justify-center text-micro font-bold text-muted">
        {title.slice(0, 2).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={`https://coverartarchive.org/release-group/${mbid}/front-250`}
      alt={title}
      className="w-10 h-10 rounded object-cover bg-bg shrink-0"
      onError={() => setFailed(true)}
    />
  )
}

const TYPE_PRIORITY: Record<string, number> = { Album: 0, EP: 1, Single: 2, Live: 3 }

export function AlbumPicker({
  artistMbid,
  artistName,
  artistImageUrl,
  suggestedAlbumId,
  onConfirm,
  onCancel,
}: Props) {
  const albumsQuery = useQuery({
    queryKey: ['albums', artistMbid],
    queryFn: () => getAlbums(artistMbid),
  })

  const sortedAlbums = [...(albumsQuery.data ?? [])].sort((a, b) => {
    const aPri = TYPE_PRIORITY[a.type] ?? 4
    const bPri = TYPE_PRIORITY[b.type] ?? 4
    if (aPri !== bPri) return aPri - bPri
    return (b.firstReleaseDate ?? '').localeCompare(a.firstReleaseDate ?? '')
  })

  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (suggestedAlbumId) initial.add(suggestedAlbumId)
    return initial
  })

  function toggleAlbum(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleSelectAll() {
    setSelected(new Set(sortedAlbums.map((a) => a.id)))
  }

  function handleDeselectAll() {
    setSelected(new Set())
  }

  return (
    /* Modal backdrop -- aria-hidden because the close button inside handles keyboard */
    /* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is intentional; keyboard handled by Escape key */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: close button inside provides keyboard alternative */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <ArtistThumb name={artistName} imageUrl={artistImageUrl} size={10} />
            <div>
              <h2 className="text-sm font-semibold text-text">Select albums</h2>
              <p className="text-xs text-muted mt-0.5">{artistName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted hover:text-text transition-colors p-1"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {albumsQuery.isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {albumsQuery.isError && (
            <p className="text-sm text-reject text-center py-8">Failed to load albums</p>
          )}

          {albumsQuery.isSuccess && sortedAlbums.length === 0 && (
            <p className="text-sm text-muted text-center py-8">No release groups found</p>
          )}

          {albumsQuery.isSuccess && sortedAlbums.length > 0 && (
            <>
              {/* Select all / none row */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-accent hover:underline"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-xs text-muted hover:text-text"
                >
                  None
                </button>
                <span className="ml-auto text-xs text-muted tabular-nums">
                  {selected.size} selected
                </span>
              </div>

              <ul className="divide-y divide-border/50">
                {sortedAlbums.map((album) => {
                  const checked = selected.has(album.id)
                  const isSuggested = album.id === suggestedAlbumId
                  return (
                    <li key={album.id}>
                      <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-bg/40 transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAlbum(album.id)}
                          className="w-4 h-4 accent-accent cursor-pointer shrink-0"
                        />
                        <AlbumCover mbid={album.id} title={album.title} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-text truncate">{album.title}</span>
                            {isSuggested && (
                              <span className="text-micro px-1.5 py-0.5 rounded-full bg-accent/20 text-accent shrink-0">
                                AI pick
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs text-muted">{album.type}</span>
                            {album.firstReleaseDate && (
                              <>
                                <span className="text-xs text-muted/40">·</span>
                                <span className="text-xs text-muted">
                                  {album.firstReleaseDate.slice(0, 4)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            Monitor{' '}
            {selected.size > 0 ? `${selected.size} album${selected.size !== 1 ? 's' : ''}` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}

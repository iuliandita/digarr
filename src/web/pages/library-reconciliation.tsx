import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LibraryUnreconciledAlbumRowComponent } from '../components/library-unreconciled-album-row'
import { LibraryUnreconciledRowComponent } from '../components/library-unreconciled-row'
import { getLibraryUnreconciled, getLibraryUnreconciledAlbums } from '../lib/api'

export function LibraryReconciliationPage() {
  const queryClient = useQueryClient()
  const { data, error, isError, isLoading } = useQuery({
    queryKey: ['library', 'unreconciled'],
    queryFn: getLibraryUnreconciled,
  })
  const {
    data: albumData,
    error: albumError,
    isError: isAlbumError,
    isLoading: isAlbumLoading,
  } = useQuery({
    queryKey: ['library', 'unreconciled-albums'],
    queryFn: getLibraryUnreconciledAlbums,
  })

  const items = data?.items ?? []
  const albumItems = albumData?.items ?? []
  const grouped = new Map<string, typeof items>()

  for (const row of items) {
    const list = grouped.get(row.source) ?? []
    list.push(row)
    grouped.set(row.source, list)
  }

  function handleResolved() {
    queryClient.invalidateQueries({ queryKey: ['library', 'unreconciled'] })
    queryClient.invalidateQueries({ queryKey: ['library', 'unreconciled-albums'] })
    queryClient.invalidateQueries({ queryKey: ['library', 'sources'] })
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-text">Unreconciled Artists</h1>
        <p className="text-sm text-muted">
          {isLoading
            ? 'Loading unreconciled artists...'
            : `${items.length} artists could not be automatically matched to MusicBrainz.`}
        </p>
      </div>

      {isLoading && (
        <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
          Loading unreconciled artists...
        </div>
      )}

      {isError && (
        <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center space-y-2">
          <div className="text-sm text-text">Could not load unreconciled artists.</div>
          <div className="text-sm text-muted">
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
          No unreconciled artists. Your library is fully matched.
        </div>
      )}

      {!isError &&
        [...grouped.entries()].map(([source, rows]) => (
          <section key={source} className="space-y-3">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
              {source} ({rows.length})
            </h2>
            <div className="space-y-2">
              {rows.map((row) => (
                <LibraryUnreconciledRowComponent
                  key={row.id}
                  row={row}
                  onResolved={handleResolved}
                />
              ))}
            </div>
          </section>
        ))}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-text">Unreconciled Albums</h2>
          <p className="text-sm text-muted">
            {isAlbumLoading
              ? 'Loading unreconciled albums...'
              : `${albumItems.length} albums could not be automatically matched to MusicBrainz.`}
          </p>
        </div>

        {isAlbumLoading && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            Loading unreconciled albums...
          </div>
        )}

        {isAlbumError && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center space-y-2">
            <div className="text-sm text-text">Could not load unreconciled albums.</div>
            <div className="text-sm text-muted">
              {albumError instanceof Error ? albumError.message : 'Unknown error'}
            </div>
          </div>
        )}

        {!isAlbumLoading && !isAlbumError && albumItems.length === 0 && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            No unreconciled albums.
          </div>
        )}

        {!isAlbumError && albumItems.length > 0 && (
          <div className="space-y-2">
            {albumItems.map((row) => (
              <LibraryUnreconciledAlbumRowComponent
                key={row.id}
                row={row}
                onResolved={handleResolved}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

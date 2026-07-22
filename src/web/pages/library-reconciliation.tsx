import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/confirm-dialog'
import {
  BULK_SELECTION_LIMIT,
  LibraryBulkReviewToolbar,
} from '../components/library-bulk-review-toolbar'
import { isBulkIgnoreEligible } from '../components/library-reconciliation-reason'
import { LibraryUnreconciledAlbumRowComponent } from '../components/library-unreconciled-album-row'
import { LibraryUnreconciledRowComponent } from '../components/library-unreconciled-row'
import {
  bulkIgnoreLibraryAlbums,
  bulkIgnoreLibraryArtists,
  getLibraryUnreconciled,
  getLibraryUnreconciledAlbums,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

const ALBUMS_PER_PAGE = 20
type BulkEntity = 'artists' | 'albums'

function selectionKey(source: string, id: string) {
  return JSON.stringify([source, id])
}

export function LibraryReconciliationPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [albumPage, setAlbumPage] = useState(1)
  const [artistSelection, setArtistSelection] = useState<Set<string>>(() => new Set())
  const [albumSelection, setAlbumSelection] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState<BulkEntity | null>(null)
  const [artistBusy, setArtistBusy] = useState(false)
  const [albumBusy, setAlbumBusy] = useState(false)
  const [artistBulkError, setArtistBulkError] = useState<string | null>(null)
  const [albumBulkError, setAlbumBulkError] = useState<string | null>(null)
  const artistSectionRef = useRef<HTMLElement>(null)
  const albumSectionRef = useRef<HTMLElement>(null)
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
  const albumTotal = albumItems.length
  const albumPageCount = Math.max(1, Math.ceil(albumTotal / ALBUMS_PER_PAGE))

  useEffect(() => {
    if (albumPage > albumPageCount) setAlbumPage(albumPageCount)
  }, [albumPage, albumPageCount])

  const visibleAlbumPage = Math.min(albumPage, albumPageCount)
  const albumPageStart = (visibleAlbumPage - 1) * ALBUMS_PER_PAGE
  const albumPageItems = albumItems.slice(albumPageStart, albumPageStart + ALBUMS_PER_PAGE)
  const artistEligibleRows = items.filter((row) => isBulkIgnoreEligible(row.unreconciledReason))
  const albumEligibleRows = albumPageItems.filter((row) =>
    isBulkIgnoreEligible(row.unreconciledReason),
  )
  const artistEligibleKeys = useMemo(
    () =>
      new Set(
        items
          .filter((row) => isBulkIgnoreEligible(row.unreconciledReason))
          .map((row) => selectionKey(row.source, row.sourceArtistId)),
      ),
    [items],
  )
  const albumEligibleKeys = useMemo(
    () =>
      new Set(
        albumItems
          .slice(albumPageStart, albumPageStart + ALBUMS_PER_PAGE)
          .filter((row) => isBulkIgnoreEligible(row.unreconciledReason))
          .map((row) => selectionKey(row.source, row.sourceAlbumId)),
      ),
    [albumItems, albumPageStart],
  )
  const grouped = new Map<string, typeof items>()

  for (const row of items) {
    const list = grouped.get(row.source) ?? []
    list.push(row)
    grouped.set(row.source, list)
  }

  async function handleResolved() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['library', 'unreconciled'] }),
      queryClient.invalidateQueries({ queryKey: ['library', 'unreconciled-albums'] }),
      queryClient.invalidateQueries({ queryKey: ['library', 'sources'] }),
    ])
  }

  useEffect(() => {
    setArtistSelection((previous) => {
      const next = new Set([...previous].filter((key) => artistEligibleKeys.has(key)))
      return next.size === previous.size ? previous : next
    })
  }, [artistEligibleKeys])

  useEffect(() => {
    if (visibleAlbumPage < 1) return
    setAlbumSelection((previous) => (previous.size === 0 ? previous : new Set()))
  }, [visibleAlbumPage])

  useEffect(() => {
    setAlbumSelection((previous) => {
      const next = new Set([...previous].filter((key) => albumEligibleKeys.has(key)))
      return next.size === previous.size ? previous : next
    })
  }, [albumEligibleKeys])

  useEffect(() => {
    setConfirming((previous) => {
      if (previous === 'artists' && artistSelection.size === 0) return null
      if (previous === 'albums' && albumSelection.size === 0) return null
      return previous
    })
  }, [artistSelection.size, albumSelection.size])

  function addVisibleArtistSelections() {
    setArtistSelection((previous) => {
      const next = new Set(previous)
      for (const row of artistEligibleRows) {
        if (next.size >= BULK_SELECTION_LIMIT) break
        next.add(selectionKey(row.source, row.sourceArtistId))
      }
      return next.size === previous.size ? previous : next
    })
  }

  function addVisibleAlbumSelections() {
    setAlbumSelection((previous) => {
      const next = new Set(previous)
      for (const row of albumEligibleRows) {
        if (next.size >= BULK_SELECTION_LIMIT) break
        next.add(selectionKey(row.source, row.sourceAlbumId))
      }
      return next.size === previous.size ? previous : next
    })
  }

  function clearVisibleArtistSelections() {
    const visibleKeys = new Set(items.map((row) => selectionKey(row.source, row.sourceArtistId)))
    setArtistSelection((previous) => {
      const next = new Set([...previous].filter((key) => !visibleKeys.has(key)))
      return next.size === previous.size ? previous : next
    })
  }

  function clearVisibleAlbumSelections() {
    const visibleKeys = new Set(
      albumPageItems.map((row) => selectionKey(row.source, row.sourceAlbumId)),
    )
    setAlbumSelection((previous) => {
      const next = new Set([...previous].filter((key) => !visibleKeys.has(key)))
      return next.size === previous.size ? previous : next
    })
  }

  function toggleArtistSelection(row: (typeof items)[number], selected: boolean) {
    const key = selectionKey(row.source, row.sourceArtistId)
    setArtistSelection((previous) => {
      if (!selected) {
        if (!previous.has(key)) return previous
        const next = new Set(previous)
        next.delete(key)
        return next
      }
      if (previous.has(key) || previous.size >= BULK_SELECTION_LIMIT) return previous
      return new Set(previous).add(key)
    })
  }

  function toggleAlbumSelection(row: (typeof albumItems)[number], selected: boolean) {
    const key = selectionKey(row.source, row.sourceAlbumId)
    setAlbumSelection((previous) => {
      if (!selected) {
        if (!previous.has(key)) return previous
        const next = new Set(previous)
        next.delete(key)
        return next
      }
      if (previous.has(key) || previous.size >= BULK_SELECTION_LIMIT) return previous
      return new Set(previous).add(key)
    })
  }

  async function confirmBulkIgnore() {
    const entity = confirming
    if (!entity) return

    const artistPayload = items
      .filter(
        (row) =>
          isBulkIgnoreEligible(row.unreconciledReason) &&
          artistSelection.has(selectionKey(row.source, row.sourceArtistId)),
      )
      .map((row) => ({ source: row.source, sourceArtistId: row.sourceArtistId }))
    const albumPayload = albumPageItems
      .filter(
        (row) =>
          isBulkIgnoreEligible(row.unreconciledReason) &&
          albumSelection.has(selectionKey(row.source, row.sourceAlbumId)),
      )
      .map((row) => ({ source: row.source, sourceAlbumId: row.sourceAlbumId }))
    const payload = entity === 'artists' ? artistPayload : albumPayload
    if (payload.length === 0) {
      setConfirming(null)
      return
    }

    setConfirming(null)
    if (entity === 'artists') {
      setArtistBusy(true)
      setArtistBulkError(null)
    } else {
      setAlbumBusy(true)
      setAlbumBulkError(null)
    }

    try {
      if (entity === 'artists') {
        await bulkIgnoreLibraryArtists(artistPayload)
        setArtistSelection(new Set())
      } else {
        await bulkIgnoreLibraryAlbums(albumPayload)
        setAlbumSelection(new Set())
      }
      await handleResolved()
    } catch {
      if (entity === 'artists') setArtistBulkError(t('libraryReconciliation.bulkIgnoreFailed'))
      else setAlbumBulkError(t('libraryReconciliation.bulkIgnoreFailed'))
    } finally {
      if (entity === 'artists') setArtistBusy(false)
      else setAlbumBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <section
        ref={artistSectionRef}
        tabIndex={-1}
        aria-label={t('libraryReconciliation.title')}
        className="space-y-6"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-text">{t('libraryReconciliation.title')}</h1>
          <p className="text-sm text-muted">
            {isLoading
              ? t('libraryReconciliation.loadingArtists')
              : `${items.length} ${t('libraryReconciliation.artistsCouldNotBeMatched')}`}
          </p>
        </div>

        {isLoading && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryReconciliation.loadingArtists')}
          </div>
        )}

        {isError && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center space-y-2">
            <div className="text-sm text-text">
              {t('libraryReconciliation.couldNotLoadArtists')}
            </div>
            <div className="text-sm text-muted">
              {error instanceof Error ? error.message : t('common.unknownError')}
            </div>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryReconciliation.noArtists')}
          </div>
        )}

        {!isLoading && !isError && (
          <LibraryBulkReviewToolbar
            selectedCount={artistSelection.size}
            eligibleCount={artistEligibleRows.length}
            busy={artistBusy}
            error={artistBulkError}
            limitReached={artistSelection.size >= BULK_SELECTION_LIMIT}
            onSelectVisible={addVisibleArtistSelections}
            onClearVisible={clearVisibleArtistSelections}
            onIgnore={() => setConfirming('artists')}
          />
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
                    bulkBusy={artistBusy}
                    selected={artistSelection.has(selectionKey(row.source, row.sourceArtistId))}
                    selectionDisabled={
                      !isBulkIgnoreEligible(row.unreconciledReason) ||
                      (!artistSelection.has(selectionKey(row.source, row.sourceArtistId)) &&
                        artistSelection.size >= BULK_SELECTION_LIMIT)
                    }
                    onSelectionChange={(selected) => toggleArtistSelection(row, selected)}
                  />
                ))}
              </div>
            </section>
          ))}
      </section>

      <section
        ref={albumSectionRef}
        tabIndex={-1}
        aria-label={t('libraryReconciliation.albumsTitle')}
        className="space-y-3"
      >
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-text">{t('libraryReconciliation.albumsTitle')}</h2>
          <p className="text-sm text-muted">
            {isAlbumLoading
              ? t('libraryReconciliation.loadingAlbums')
              : `${albumTotal} ${t('libraryReconciliation.albumsCouldNotBeMatched')}`}
          </p>
        </div>

        {isAlbumLoading && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryReconciliation.loadingAlbums')}
          </div>
        )}

        {isAlbumError && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center space-y-2">
            <div className="text-sm text-text">{t('libraryReconciliation.couldNotLoadAlbums')}</div>
            <div className="text-sm text-muted">
              {albumError instanceof Error ? albumError.message : t('common.unknownError')}
            </div>
          </div>
        )}

        {!isAlbumLoading && !isAlbumError && albumItems.length === 0 && (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryReconciliation.noAlbums')}
          </div>
        )}

        {!isAlbumLoading && !isAlbumError && (
          <LibraryBulkReviewToolbar
            selectedCount={albumSelection.size}
            eligibleCount={albumEligibleRows.length}
            busy={albumBusy}
            error={albumBulkError}
            limitReached={albumSelection.size >= BULK_SELECTION_LIMIT}
            onSelectVisible={addVisibleAlbumSelections}
            onClearVisible={clearVisibleAlbumSelections}
            onIgnore={() => setConfirming('albums')}
          />
        )}

        {!isAlbumError && albumTotal > 0 && (
          <div className="space-y-3">
            <div className="space-y-2">
              {albumPageItems.map((row) => (
                <LibraryUnreconciledAlbumRowComponent
                  key={row.id}
                  row={row}
                  onResolved={handleResolved}
                  bulkBusy={albumBusy}
                  selected={albumSelection.has(selectionKey(row.source, row.sourceAlbumId))}
                  selectionDisabled={
                    !isBulkIgnoreEligible(row.unreconciledReason) ||
                    (!albumSelection.has(selectionKey(row.source, row.sourceAlbumId)) &&
                      albumSelection.size >= BULK_SELECTION_LIMIT)
                  }
                  onSelectionChange={(selected) => toggleAlbumSelection(row, selected)}
                />
              ))}
            </div>

            {albumPageCount > 1 && (
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-xs text-muted">
                  {t('libraryReconciliation.showing')} {albumPageStart + 1}-
                  {Math.min(albumPageStart + ALBUMS_PER_PAGE, albumTotal)}{' '}
                  {t('libraryReconciliation.of')} {albumTotal}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAlbumPage(Math.max(1, visibleAlbumPage - 1))}
                    disabled={visibleAlbumPage === 1}
                    className="px-2.5 py-1 text-xs font-medium text-text border border-border rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {t('common.previous')}
                  </button>
                  <span className="text-xs text-muted tabular-nums">
                    {t('libraryReconciliation.page')} {visibleAlbumPage} / {albumPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAlbumPage(Math.min(albumPageCount, visibleAlbumPage + 1))}
                    disabled={visibleAlbumPage === albumPageCount}
                    className="px-2.5 py-1 text-xs font-medium text-text border border-border rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {confirming && (
        <ConfirmDialog
          title={t(
            confirming === 'artists'
              ? 'libraryReconciliation.confirmArtistsTitle'
              : 'libraryReconciliation.confirmAlbumsTitle',
          )}
          message={t(
            confirming === 'artists'
              ? 'libraryReconciliation.confirmArtistsMessage'
              : 'libraryReconciliation.confirmAlbumsMessage',
          ).replace(
            '{0}',
            String(confirming === 'artists' ? artistSelection.size : albumSelection.size),
          )}
          onConfirm={confirmBulkIgnore}
          onCancel={() => setConfirming(null)}
          fallbackFocusRef={confirming === 'artists' ? artistSectionRef : albumSectionRef}
        />
      )}
    </div>
  )
}

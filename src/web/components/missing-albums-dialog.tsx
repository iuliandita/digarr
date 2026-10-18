import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useDialogFocus } from '../hooks/use-dialog-focus'
import {
  ApiError,
  approveMissingAlbums,
  getLibraryAlbumCoverage,
  type LibraryAlbumCoverage,
  type MissingAlbumsApprovalResponse,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

type Props = {
  open: boolean
  onClose: () => void
  artistId: number
  artistMbid: string
  artistName: string
}

export function MissingAlbumsDialog({ open, ...props }: Props) {
  return open
    ? createPortal(<MissingAlbumsContent key={props.artistMbid} {...props} />, document.body)
    : null
}

function MissingAlbumsContent({ onClose, artistId, artistMbid, artistName }: Omit<Props, 'open'>) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [albums, setAlbums] = useState<LibraryAlbumCoverage['missing'] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, 'approved' | 'requested' | 'failed'>>({})
  const [result, setResult] = useState<MissingAlbumsApprovalResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const close = () => {
    if (!pendingRef.current) onClose()
  }
  const dialogRef = useDialogFocus(true, close, closeRef)
  const { data, isError } = useQuery({
    queryKey: ['library-album-coverage', artistMbid],
    queryFn: () => getLibraryAlbumCoverage(artistMbid),
    retry: false,
  })

  useEffect(() => {
    if (!data || albums !== null) return
    // Keep the reviewed list stable when approval invalidates coverage.
    setAlbums(data.missing)
    setSelected(data.missing.map((album) => album.albumMbid))
  }, [data, albums])

  const selectedIds = selected.filter((id) => !result || outcomes[id] === 'failed')
  const resultLabel = result
    ? result.requested
      ? `${t('approvalRequests.created')} (${result.requested})`
      : t('missingAlbums.result')
          .replace('{succeeded}', String(result.succeeded))
          .replace('{failed}', String(result.failed))
    : ''

  async function submit() {
    if (pendingRef.current || selectedIds.length === 0) return
    pendingRef.current = true
    setSubmitting(true)
    setApproveError(null)
    try {
      const response = await approveMissingAlbums(artistId, selectedIds)
      const nextOutcomes = { ...outcomes }
      for (const id of selectedIds) {
        const outcome = response.results.find((item) => item.albumMbid === id)
        nextOutcomes[id] =
          outcome?.status === 'requested' ? 'requested' : outcome?.success ? 'approved' : 'failed'
      }
      const failed = selectedIds.filter((id) => nextOutcomes[id] === 'failed')
      const summary = {
        ...response,
        succeeded: Object.values(nextOutcomes).filter((status) => status === 'approved').length,
        failed: Object.values(nextOutcomes).filter((status) => status === 'failed').length,
        requested: Object.values(nextOutcomes).filter((status) => status === 'requested').length,
      }
      setOutcomes(nextOutcomes)
      setResult(summary)
      setSelected(failed)
      void queryClient.invalidateQueries({ queryKey: ['library-album-coverage', artistMbid] })
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
      void queryClient.invalidateQueries({ queryKey: ['approval-requests'] })
      if (response.results.some((item) => item.status === 'request_limit_reached'))
        toast.error(t('errors.approval.requestLimit'))
      if (summary.failed === 0) {
        toast.success(
          summary.requested
            ? `${t('approvalRequests.created')} (${summary.requested})`
            : t('missingAlbums.result')
                .replace('{succeeded}', String(summary.succeeded))
                .replace('{failed}', '0'),
        )
        onClose()
      }
    } catch (error) {
      setApproveError(error instanceof ApiError ? error.message : t('missingAlbums.approveError'))
    } finally {
      pendingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 backdrop-blur-sm p-0 md:items-center md:p-4"
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={submitting}
        tabIndex={-1}
        className="w-full max-h-[85vh] overflow-y-auto rounded-t-xl border border-border bg-surface p-4 text-text shadow-2xl md:max-w-md md:rounded-xl"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t('missingAlbums.title')}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-muted">
          {t('missingAlbums.description').replace('{artist}', artistName)}
        </p>
        {albums === null && !isError && (
          <p role="status" className="mt-4 text-sm">
            {t('common.loading')}
          </p>
        )}
        {isError && albums === null && (
          <p role="alert" className="mt-4 text-sm text-reject">
            {t('missingAlbums.loadError')}
          </p>
        )}
        {albums?.length === 0 && <p className="mt-4 text-sm">{t('missingAlbums.empty')}</p>}
        {albums && albums.length > 0 && (
          <>
            <p className="mt-4 text-sm text-muted" aria-live="polite">
              {t('missingAlbums.selected')
                .replace('{selected}', String(selectedIds.length))
                .replace('{total}', String(albums.length))}
            </p>
            <ul className="mt-2 space-y-2">
              {albums.map((album) => (
                <li key={album.albumMbid}>
                  <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(album.albumMbid)}
                      disabled={
                        submitting || (result !== null && outcomes[album.albumMbid] !== 'failed')
                      }
                      onChange={(event) => {
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, album.albumMbid]
                            : current.filter((id) => id !== album.albumMbid),
                        )
                      }}
                      className="mt-1 accent-accent"
                    />
                    <span>
                      {album.title}
                      {album.releaseYear !== null ? ` (${album.releaseYear})` : ''}
                      {outcomes[album.albumMbid] !== undefined && (
                        <span
                          className={`block text-xs ${outcomes[album.albumMbid] === 'failed' ? 'text-reject' : 'text-approve'}`}
                        >
                          {t(
                            outcomes[album.albumMbid] === 'requested'
                              ? 'approvalRequests.pending'
                              : outcomes[album.albumMbid] === 'approved'
                                ? 'missingAlbums.success'
                                : 'missingAlbums.failed',
                          )}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {result && (
          <p role="status" className="mt-3 text-sm">
            {resultLabel}
          </p>
        )}
        {approveError && (
          <p role="alert" className="mt-3 text-sm text-reject">
            {approveError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={closeRef}
            size="sm"
            variant="ghost"
            onClick={close}
            aria-disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || selectedIds.length === 0}>
            {t(submitting ? 'common.loading' : 'missingAlbums.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}

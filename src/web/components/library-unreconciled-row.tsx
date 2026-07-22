import { useId, useState } from 'react'
import type { LibraryUnreconciledRow as Row } from '../lib/api'
import { rerunLibraryReconciler, saveLibraryOverride } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { isBulkIgnoreEligible, LibraryReconciliationReason } from './library-reconciliation-reason'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function LibraryUnreconciledRowComponent({
  row,
  onResolved,
  selected,
  selectionDisabled,
  bulkBusy,
  onSelectionChange,
}: {
  row: Row
  onResolved: () => void | Promise<void>
  selected: boolean
  selectionDisabled: boolean
  bulkBusy: boolean
  onSelectionChange: (selected: boolean) => void
}) {
  const { t } = useI18n()
  const nameId = useId()
  const [mbidInput, setMbidInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSelectionDisabled =
    busy || bulkBusy || selectionDisabled || !isBulkIgnoreEligible(row.unreconciledReason)
  const isActionDisabled = busy || bulkBusy

  async function pinMbid() {
    const mbid = mbidInput.trim()
    setError(null)
    if (!UUID_RE.test(mbid)) {
      setError(t('libraryReconciliation.invalidMbid'))
      return
    }

    onSelectionChange(false)
    setBusy(true)
    try {
      await saveLibraryOverride({
        source: row.source,
        sourceArtistId: row.sourceArtistId,
        correctMbid: mbid,
      })
      await rerunLibraryReconciler().catch(() => undefined)
      setMbidInput('')
      await onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function ignore() {
    setError(null)
    onSelectionChange(false)
    setBusy(true)
    try {
      await saveLibraryOverride({
        source: row.source,
        sourceArtistId: row.sourceArtistId,
        correctMbid: null,
      })
      await rerunLibraryReconciler().catch(() => undefined)
      await onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset
      aria-labelledby={nameId}
      className="min-w-0 bg-surface border border-border rounded-lg p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <label
          className={`flex min-h-11 min-w-11 items-center justify-center ${isSelectionDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectionChange(event.target.checked)}
            disabled={isSelectionDisabled}
            aria-label={t('libraryReconciliation.selectArtist').replace('{0}', () => row.name)}
            className="h-5 w-5 accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <div className="min-w-0 flex-1 space-y-1">
          <div id={nameId} className="font-medium text-text break-words">
            {row.name}
          </div>
          <div className="text-xs text-muted break-words">
            {row.source} -{' '}
            {t('libraryReconciliation.normalizedName').replace('{0}', () => row.nameNormalized)}
          </div>
          <LibraryReconciliationReason reason={row.unreconciledReason} />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={mbidInput}
          onChange={(e) => setMbidInput(e.target.value)}
          placeholder={t('libraryReconciliation.pasteMbid')}
          className="flex-1 px-2 py-1 border border-border rounded bg-bg text-text text-sm"
          disabled={isActionDisabled}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pinMbid}
            disabled={isActionDisabled}
            className="text-sm px-3 py-1 border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t('libraryReconciliation.pin')}
          </button>
          <button
            type="button"
            onClick={ignore}
            disabled={isActionDisabled}
            className="text-sm px-3 py-1 border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t('libraryReconciliation.ignoreForever')}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-500">{error}</div>}
    </fieldset>
  )
}

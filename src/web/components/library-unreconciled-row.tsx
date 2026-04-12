import { useState } from 'react'
import type { LibraryUnreconciledRow as Row } from '../lib/api'
import { rerunLibraryReconciler, saveLibraryOverride } from '../lib/api'
import { useI18n } from '../lib/i18n'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function LibraryUnreconciledRowComponent({
  row,
  onResolved,
}: {
  row: Row
  onResolved: () => void
}) {
  const { t } = useI18n()
  const [mbidInput, setMbidInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pinMbid() {
    const mbid = mbidInput.trim()
    setError(null)
    if (!UUID_RE.test(mbid)) {
      setError(t('libraryReconciliation.invalidMbid'))
      return
    }

    setBusy(true)
    try {
      await saveLibraryOverride({
        source: row.source,
        sourceArtistId: row.sourceArtistId,
        correctMbid: mbid,
      })
      await rerunLibraryReconciler().catch(() => undefined)
      setMbidInput('')
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function ignore() {
    setError(null)
    setBusy(true)
    try {
      await saveLibraryOverride({
        source: row.source,
        sourceArtistId: row.sourceArtistId,
        correctMbid: null,
      })
      await rerunLibraryReconciler().catch(() => undefined)
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-3 space-y-2">
      <div className="space-y-1">
        <div className="font-medium text-text">{row.name}</div>
        <div className="text-xs text-muted">
          {row.source} - normalized: {row.nameNormalized}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={mbidInput}
          onChange={(e) => setMbidInput(e.target.value)}
          placeholder={t('libraryReconciliation.pasteMbid')}
          className="flex-1 px-2 py-1 border border-border rounded bg-bg text-text text-sm"
          disabled={busy}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pinMbid}
            disabled={busy}
            className="text-sm px-3 py-1 border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t('libraryReconciliation.pin')}
          </button>
          <button
            type="button"
            onClick={ignore}
            disabled={busy}
            className="text-sm px-3 py-1 border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t('libraryReconciliation.ignoreForever')}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  )
}

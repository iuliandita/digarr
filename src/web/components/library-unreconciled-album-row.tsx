import type { LibraryUnreconciledAlbumRow as Row } from '../lib/api'
import { saveLibraryAlbumOverride } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { LibraryUnreconciledReviewRow } from './library-unreconciled-review-row'

export function LibraryUnreconciledAlbumRowComponent({
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
  const typeLabel = row.primaryType ?? t('libraryReconciliation.unknownType')
  const yearLabel = row.releaseYear ?? t('libraryReconciliation.unknownYear')

  // selectionLabel uses a function replacer: user titles may contain
  // $-sequences that a string replacement would expand ($&, $1, ...).
  return (
    <LibraryUnreconciledReviewRow
      title={row.title}
      metadata={`${row.source} - ${typeLabel} - ${yearLabel}`}
      reason={row.unreconciledReason}
      selectionLabel={t('libraryReconciliation.selectAlbum').replace('{0}', () => row.title)}
      mbidPlaceholder={t('libraryReconciliation.pasteAlbumMbid')}
      onResolved={onResolved}
      selected={selected}
      selectionDisabled={selectionDisabled}
      bulkBusy={bulkBusy}
      onSelectionChange={onSelectionChange}
      saveOverride={(mbid) =>
        saveLibraryAlbumOverride({
          source: row.source,
          sourceAlbumId: row.sourceAlbumId,
          correctAlbumMbid: mbid,
        })
      }
    />
  )
}

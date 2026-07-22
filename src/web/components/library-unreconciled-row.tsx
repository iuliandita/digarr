import type { LibraryUnreconciledRow as Row } from '../lib/api'
import { saveLibraryOverride } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { LibraryUnreconciledReviewRow } from './library-unreconciled-review-row'

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
  return (
    <LibraryUnreconciledReviewRow
      title={row.name}
      metadata={
        <>
          {row.source} -{' '}
          {t('libraryReconciliation.normalizedName').replace('{0}', () => row.nameNormalized)}
        </>
      }
      reason={row.unreconciledReason}
      selectionLabel={t('libraryReconciliation.selectArtist').replace('{0}', () => row.name)}
      mbidPlaceholder={t('libraryReconciliation.pasteMbid')}
      onResolved={onResolved}
      selected={selected}
      selectionDisabled={selectionDisabled}
      bulkBusy={bulkBusy}
      onSelectionChange={onSelectionChange}
      saveOverride={(mbid) =>
        saveLibraryOverride({
          source: row.source,
          sourceArtistId: row.sourceArtistId,
          correctMbid: mbid,
        })
      }
    />
  )
}

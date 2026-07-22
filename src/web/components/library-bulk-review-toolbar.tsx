import { LIBRARY_BULK_IGNORE_LIMIT } from '@/core/library/types'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

type Props = {
  selectedCount: number
  eligibleCount: number
  busy: boolean
  error: string | null
  limitReached: boolean
  onSelectVisible: () => void
  onClearVisible: () => void
  onIgnore: () => void
}

export function LibraryBulkReviewToolbar({
  selectedCount,
  eligibleCount,
  busy,
  error,
  limitReached,
  onSelectVisible,
  onClearVisible,
  onIgnore,
}: Props) {
  const { t } = useI18n()
  const selectDisabled =
    busy || eligibleCount === 0 || selectedCount >= eligibleCount || limitReached

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text">
      <Button type="button" variant="outline" onClick={onSelectVisible} disabled={selectDisabled}>
        {t('libraryReconciliation.selectVisible')}
      </Button>
      {selectedCount > 0 && (
        <Button type="button" variant="outline" onClick={onClearVisible} disabled={busy}>
          {t('libraryReconciliation.clearVisible')}
        </Button>
      )}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 break-words text-text"
      >
        {t('libraryReconciliation.selectedCount').replace('{0}', String(selectedCount))}
        {limitReached && (
          <>
            {' '}
            {t('libraryReconciliation.selectionLimit').replace(
              '{0}',
              String(LIBRARY_BULK_IGNORE_LIMIT),
            )}
          </>
        )}
      </span>
      <Button
        type="button"
        variant="destructive"
        onClick={onIgnore}
        disabled={busy || selectedCount === 0}
      >
        {t('libraryReconciliation.ignoreSelected')}
      </Button>
      {error && (
        <span role="alert" className="min-w-0 break-words text-text">
          {error}
        </span>
      )}
    </div>
  )
}

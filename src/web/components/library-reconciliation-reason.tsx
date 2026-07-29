import type { MessageKey } from '@/core/i18n/messages/types'
import type { LibraryUnreconciledReason } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Badge, type BadgeProps } from './ui/badge'

export type DisplayReason = LibraryUnreconciledReason | 'needs_review'

type ReasonMessages = {
  label: MessageKey
  help: MessageKey
  variant: NonNullable<BadgeProps['variant']>
}

const REASON_MESSAGES: Record<DisplayReason, ReasonMessages> = {
  ambiguous: {
    label: 'libraryReconciliation.reasonAmbiguousLabel',
    help: 'libraryReconciliation.reasonAmbiguousHelp',
    variant: 'default',
  },
  no_candidate: {
    label: 'libraryReconciliation.reasonNoCandidateLabel',
    help: 'libraryReconciliation.reasonNoCandidateHelp',
    variant: 'outline',
  },
  lookup_failed: {
    label: 'libraryReconciliation.reasonLookupFailedLabel',
    help: 'libraryReconciliation.reasonLookupFailedHelp',
    variant: 'destructive',
  },
  needs_review: {
    label: 'libraryReconciliation.reasonNeedsReviewLabel',
    help: 'libraryReconciliation.reasonNeedsReviewHelp',
    variant: 'info',
  },
}

export function normalizeUnreconciledReason(reason: string | null | undefined): DisplayReason {
  if (reason === 'ambiguous' || reason === 'no_candidate' || reason === 'lookup_failed') {
    return reason
  }

  return 'needs_review'
}

export function isBulkIgnoreEligible(reason: string | null | undefined): boolean {
  return normalizeUnreconciledReason(reason) !== 'lookup_failed'
}

export function LibraryReconciliationReason({ reason }: { reason: string | null | undefined }) {
  const { t } = useI18n()
  const messages = REASON_MESSAGES[normalizeUnreconciledReason(reason)]

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge variant={messages.variant} className="text-text">
        {t(messages.label)}
      </Badge>
      <span className="min-w-0 break-words text-text">{t(messages.help)}</span>
    </div>
  )
}

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBulkIgnoreEligible,
  LibraryReconciliationReason,
  normalizeUnreconciledReason,
} from '@/web/components/library-reconciliation-reason'
import { I18nProvider } from '@/web/lib/i18n'

function renderReason(reason: string | null | undefined) {
  return render(
    <I18nProvider>
      <LibraryReconciliationReason reason={reason} />
    </I18nProvider>,
  )
}

describe('LibraryReconciliationReason', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    })
  })

  it.each([
    [
      'ambiguous',
      'Ambiguous match',
      'Multiple matches remain. Pin the correct MBID or ignore this item.',
    ],
    ['no_candidate', 'No match found', 'No match was found. Pin a known MBID or ignore this item.'],
    [
      'lookup_failed',
      'Lookup failed',
      'MusicBrainz could not be reached. Retry the library sync later.',
    ],
    [
      null,
      'Needs review',
      'The cause predates reason tracking. Rerun reconciliation or review it manually.',
    ],
    [
      'unexpected_reason',
      'Needs review',
      'The cause predates reason tracking. Rerun reconciliation or review it manually.',
    ],
  ])('renders the %s reason label and guidance', (reason, label, help) => {
    renderReason(reason)

    expect(screen.getByText(label)).toHaveClass('text-text')
    expect(screen.getByText(help)).toHaveClass('text-text')
  })

  it('normalizes legacy and unknown values to needs review', () => {
    expect(normalizeUnreconciledReason(null)).toBe('needs_review')
    expect(normalizeUnreconciledReason(undefined)).toBe('needs_review')
    expect(normalizeUnreconciledReason('unexpected_reason')).toBe('needs_review')
  })

  it('excludes only lookup failures from bulk ignore', () => {
    expect(isBulkIgnoreEligible('lookup_failed')).toBe(false)
    expect(isBulkIgnoreEligible('ambiguous')).toBe(true)
    expect(isBulkIgnoreEligible('no_candidate')).toBe(true)
    expect(isBulkIgnoreEligible(null)).toBe(true)
    expect(isBulkIgnoreEligible(undefined)).toBe(true)
    expect(isBulkIgnoreEligible('unexpected_reason')).toBe(true)
  })
})

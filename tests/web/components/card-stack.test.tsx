// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CardStack } from '@/web/components/card-stack'
import type { Recommendation } from '@/web/components/recommendation-card'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

const rec = (id: number) =>
  ({
    id,
    score: 0.5,
    status: 'pending',
    kind: 'artist',
    artist: { id, name: `Artist ${id}`, mbid: `mbid-${id}`, genres: [], tags: [] },
  }) as unknown as Recommendation

const recs = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => rec(from + i))

function stack(recommendations: Recommendation[], onNearEnd = vi.fn()) {
  return (
    <I18nProvider>
      <CardStack
        recommendations={recommendations}
        totalCount={60}
        resetKey="pending"
        onNearEnd={onNearEnd}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onDetail={vi.fn()}
      />
    </I18nProvider>
  )
}

describe('CardStack keyboard (#985)', () => {
  it('r opens the reason picker like the left arrow', () => {
    render(stack(recs(1, 3)))
    fireEvent.keyDown(window, { key: 'r' })
    expect(screen.getByRole('dialog', { name: /Why are you rejecting/ })).toBeInTheDocument()
  })
})

describe('CardStack paging (#882)', () => {
  it('asks for more near the end and keeps the current card when a page is appended', () => {
    const onNearEnd = vi.fn()
    const { rerender } = render(stack(recs(1, 8), onNearEnd))
    expect(screen.getByText('1 of 60')).toBeInTheDocument()
    expect(onNearEnd).not.toHaveBeenCalled()

    const next = screen.getByRole('button', { name: 'Next card' })
    fireEvent.click(next)
    fireEvent.click(next)
    fireEvent.click(next)
    expect(screen.getByText('Artist 4')).toBeInTheDocument()
    expect(onNearEnd).toHaveBeenCalled()

    rerender(stack(recs(1, 16), onNearEnd))
    expect(screen.getByText('Artist 4')).toBeInTheDocument()
    expect(screen.getByText('4 of 60')).toBeInTheDocument()
  })
})

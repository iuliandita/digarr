// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/api', () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}))

import { listJobs } from '@/web/lib/api'
import JobHistoryPage from '@/web/pages/job-history'
import { createTestQueryClient } from '../helpers/query'

describe('JobHistoryPage', () => {
  it('filters to failed runs', async () => {
    const client = createTestQueryClient()
    render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <JobHistoryPage />
        </QueryClientProvider>
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByLabelText('Failures only'))

    await waitFor(() =>
      expect(listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' })),
    )
  })
})

// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalRequests } from '@/web/components/approval-requests'
import {
  type ApprovalRequest,
  listApprovalRequests,
  listOwnApprovalRequests,
  resolveApprovalRequest,
} from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())
vi.mock('@/web/lib/api', () => ({
  listApprovalRequests: vi.fn(),
  listOwnApprovalRequests: vi.fn(),
  resolveApprovalRequest: vi.fn(),
}))

const request: ApprovalRequest = {
  id: 1,
  token: 'request-token',
  recommendationId: 10,
  requester: { id: 2, username: 'listener' },
  recommendation: {
    artistName: 'Portishead',
    albumTitle: 'Dummy',
    score: 0.87,
    reasons: ['Matches your listening history.'],
  },
  status: 'pending',
  lastError: null,
  note: null,
  createdAt: '2026-10-18T10:00:00Z',
}

function mount(admin = false) {
  const client = createTestQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <ApprovalRequests admin={admin} />
      </QueryClientProvider>
    </I18nProvider>,
  )
  return invalidate
}

describe('ApprovalRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(listApprovalRequests).mockResolvedValue([request])
    vi.mocked(listOwnApprovalRequests).mockResolvedValue([request])
    vi.mocked(resolveApprovalRequest).mockResolvedValue({
      request: { status: 'approved' },
      approval: { status: 'approved' },
    })
  })

  it.each(['approve', 'decline'] as const)(
    'lets an admin %s with a note and refreshes request and recommendation caches',
    async (decision) => {
      const invalidate = mount(true)
      expect(await screen.findByText('Portishead - Dummy')).toBeInTheDocument()
      expect(screen.getByText('Requested by: listener')).toBeInTheDocument()
      expect(screen.getByText('Score: 87%')).toBeInTheDocument()
      expect(screen.getByText('Matches your listening history.')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Optional note'), {
        target: { value: '  Reviewed  ' },
      })
      fireEvent.click(
        screen.getByRole('button', { name: decision === 'approve' ? 'Approve' : 'Decline' }),
      )
      await waitFor(() =>
        expect(resolveApprovalRequest).toHaveBeenCalledWith(1, decision, 'Reviewed'),
      )
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['approval-requests'] }),
      )
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recommendations'] })
    },
  )

  it('shows own pending and declined requests with the decision note, without admin actions', async () => {
    vi.mocked(listOwnApprovalRequests).mockResolvedValue([
      request,
      { ...request, id: 2, status: 'declined', note: 'Try a different album.' },
      { ...request, id: 3, status: 'approved' },
    ])
    mount()
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.getByText('Declined')).toBeInTheDocument()
    expect(screen.getByText('Note: Try a different album.')).toBeInTheDocument()
    expect(screen.queryByText('Approved')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a pending approval error to admins and keeps retry and decline actions', async () => {
    vi.mocked(listApprovalRequests).mockResolvedValue([
      { ...request, lastError: 'Lidarr connection refused' },
    ])
    mount(true)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Approval failed: Lidarr connection refused',
    )
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
  })

  it.each(['pending', 'approved'] as const)(
    'reports target failures for a %s request without showing a completed decision toast',
    async (status) => {
      vi.mocked(resolveApprovalRequest).mockResolvedValue({
        request: { status },
        approval: { status: 'add_failed' },
      })
      mount(true)
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
      await waitFor(() => expect(toast.error).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
    },
  )
})

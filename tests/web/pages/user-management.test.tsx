// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </I18nProvider>,
  )
}

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

vi.mock('@/web/lib/api', () => ({
  createUserApi: vi.fn(),
  deleteUserApi: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 1,
    username: 'admin',
    isAdmin: true,
  }),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  listUsers: vi.fn().mockResolvedValue([]),
  updateUserAdmin: vi.fn(),
  updateUserApprovalSettings: vi.fn().mockResolvedValue({}),
  listApprovalRequests: vi.fn().mockResolvedValue([]),
  resolveApprovalRequest: vi.fn(),
}))

import { listUsers, updateUserApprovalSettings } from '@/web/lib/api'
import { UserManagementPage } from '@/web/pages/user-management'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

describe('UserManagementPage', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('saves a request-only policy with an unlimited request quota', async () => {
    vi.mocked(listUsers).mockResolvedValueOnce([
      {
        id: 2,
        username: 'listener',
        isAdmin: false,
        email: null,
        oidcSubject: null,
        authProvider: 'local',
        createdAt: '',
        approvalPolicy: 'direct',
        maxOpenRequests: 3,
        approvalThreshold: null,
      },
    ])
    renderWithQuery(<UserManagementPage />)
    const form = await screen.findByRole('form', { name: 'Approval policy - listener' })
    fireEvent.change(within(form).getByLabelText('Approval policy'), {
      target: { value: 'request_only' },
    })
    fireEvent.change(within(form).getByLabelText('Maximum open requests'), {
      target: { value: '' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateUserApprovalSettings).toHaveBeenCalledWith(2, {
        approvalPolicy: 'request_only',
        maxOpenRequests: null,
        approvalThreshold: null,
      }),
    )
  })
})

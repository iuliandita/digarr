// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getLidarrApproveOptions: vi.fn(),
  }
})

import { ApproveDialog } from '@/web/components/approve-dialog'
import { getLidarrApproveOptions } from '@/web/lib/api'

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <I18nProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('ApproveDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('snaps to first available folder when default id is not in the loaded list', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [{ id: 2, name: 'Standard' }],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [
        { id: 5, path: '/music5' },
        { id: 7, path: '/music7' },
      ],
    })

    const onConfirm = vi.fn()
    renderWithProviders(
      <ApproveDialog
        defaults={{ qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 }}
        monitorOption="all"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    // Wait for options to load — button becomes enabled once all selects populate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to lidarr/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ rootFolderId: 5 }))
  })

  it('keeps default id when it exists among loaded folders', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [{ id: 2, name: 'Standard' }],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [
        { id: 1, path: '/music' },
        { id: 5, path: '/music5' },
      ],
    })

    const onConfirm = vi.fn()
    renderWithProviders(
      <ApproveDialog
        defaults={{ qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 }}
        monitorOption="all"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to lidarr/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ rootFolderId: 1 }))
  })
})

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
    createLidarrTag: vi.fn(),
  }
})

import { ApproveDialog } from '@/web/components/approve-dialog'
import { createLidarrTag, getLidarrApproveOptions } from '@/web/lib/api'

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

  it('snaps to first available Lidarr options when defaults are not in the loaded lists', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [{ id: 2, name: 'Standard' }],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [
        { id: 5, path: '/music5' },
        { id: 7, path: '/music7' },
      ],
      defaults: { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    })

    const onConfirm = vi.fn()
    renderWithProviders(
      <ApproveDialog monitorOption="all" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to lidarr/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ qualityProfileId: 2, metadataProfileId: 3, rootFolderId: 5 }),
    )
  })

  it('pre-fills the target defaults and loads options from that target', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [
        { id: 2, name: 'Standard' },
        { id: 4, name: 'Lossless' },
      ],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [
        { id: 1, path: '/music' },
        { id: 5, path: '/music5' },
      ],
      defaults: { qualityProfileId: 4, metadataProfileId: null, rootFolderId: 5 },
    })

    const onConfirm = vi.fn()
    renderWithProviders(
      <ApproveDialog
        lidarrTargetId={9}
        monitorOption="all"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to lidarr/i })).not.toBeDisabled()
    })
    expect(getLidarrApproveOptions).toHaveBeenCalledWith(9)

    fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ qualityProfileId: 4, metadataProfileId: 3, rootFolderId: 5 }),
    )
  })

  it('shows monitoring up front and keeps profile pickers under collapsed Lidarr options', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [{ id: 2, name: 'Standard' }],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [{ id: 5, path: '/music' }],
    })
    renderWithProviders(
      <ApproveDialog monitorOption="all" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )

    const toggle = await screen.findByRole('button', { name: 'Lidarr options' })
    expect(screen.getByText('Monitoring options')).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('/music').closest('[hidden]')).not.toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('/music').closest('[hidden]')).toBeNull()
  })
})

describe('ApproveDialog monitor option', () => {
  it.each(['missing', 'existing', 'latest', 'first'] as const)(
    'submits %s and selected tags from the target instance',
    async (monitorOption) => {
      vi.mocked(getLidarrApproveOptions).mockResolvedValue({
        qualityProfiles: [{ id: 2, name: 'Standard' }],
        metadataProfiles: [{ id: 3, name: 'Standard' }],
        rootFolders: [{ id: 5, path: '/music' }],
        tags: [{ id: 4, label: 'discovery' }],
        defaults: { qualityProfileId: 2, metadataProfileId: 3, rootFolderId: 5, tags: [4] },
      })
      vi.mocked(createLidarrTag).mockResolvedValue({ id: 7, label: 'digarr' })
      const onConfirm = vi.fn()
      renderWithProviders(
        <ApproveDialog
          lidarrTargetId={9}
          monitorOption={monitorOption}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Lidarr options' }))
      expect(screen.getByRole('checkbox', { name: 'discovery' })).toBeChecked()
      fireEvent.click(screen.getByRole('checkbox', { name: 'discovery' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'New tag' }), {
        target: { value: 'digarr' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create tag' }))
      await waitFor(() => expect(screen.getByRole('checkbox', { name: 'digarr' })).toBeChecked())
      expect(createLidarrTag).toHaveBeenCalledWith('digarr', 9)
      fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ monitorOption, tags: [7] }))
    },
  )

  it('shows and submits Popular when opened with it', async () => {
    vi.mocked(getLidarrApproveOptions).mockResolvedValue({
      qualityProfiles: [{ id: 2, name: 'Standard' }],
      metadataProfiles: [{ id: 3, name: 'Standard' }],
      rootFolders: [{ id: 5, path: '/music' }],
    })
    const onConfirm = vi.fn()
    renderWithProviders(
      <ApproveDialog monitorOption="popular" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to lidarr/i })).not.toBeDisabled()
    })
    expect(screen.getByDisplayValue('Popular albums')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add to lidarr/i }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ monitorOption: 'popular' }))
  })
})

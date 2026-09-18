// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({ listTargets: vi.fn() }))

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return { ...actual, listTargets: apiMocks.listTargets }
})

import { PlaylistForm } from '@/web/components/playlist-form'
import type { PlaylistInsert } from '@/web/lib/api'

function renderForm(onSave: (data: PlaylistInsert) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <PlaylistForm onSave={onSave} onCancel={() => {}} />
      </QueryClientProvider>
    </I18nProvider>,
  )
}

describe('PlaylistForm targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listTargets.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        type: 'navidrome-playlist',
        name: 'Navidrome',
        config: {},
        enabled: true,
        owned: true,
      },
      {
        id: 2,
        userId: 1,
        type: 'spotify-playlist',
        name: 'Spotify',
        config: {},
        enabled: true,
        owned: true,
      },
      {
        id: 3,
        userId: 1,
        type: 'lidarr',
        name: 'Lidarr',
        config: {},
        enabled: true,
        owned: true,
      },
      {
        id: 4,
        userId: 2,
        type: 'plex-playlist',
        name: 'Someone elses Plex',
        config: {},
        enabled: true,
        owned: false,
      },
    ])
  })

  it('offers only owned playlist targets and submits the selected ids', async () => {
    const onSave = vi.fn()
    renderForm(onSave)

    const navidrome = await screen.findByLabelText('Navidrome')
    expect(screen.getByLabelText('Spotify')).toBeInTheDocument()
    expect(screen.queryByLabelText('Lidarr')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Someone elses Plex')).not.toBeInTheDocument()

    fireEvent.click(navidrome)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ targetIds: [1] })),
    )
  })
  it('creates a scheduled audition playlist with the selected target', async () => {
    const onSave = vi.fn()
    renderForm(onSave)
    fireEvent.click(await screen.findByLabelText('Navidrome'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Try these' } })
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'audition' } })
    fireEvent.click(screen.getByLabelText('Schedule automatic generation'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'audition',
          targetIds: [1],
          schedule: '0 8 * * 1',
        }),
      ),
    )
  })
})

// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { LidarrPreferencesSection } from '@/web/pages/settings/lidarr-preferences'
import { NotificationChannelsCard } from '@/web/pages/settings/notification-channels'
import { TargetsTab } from '@/web/pages/settings/targets-tab'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getUserPreferences: vi.fn(),
    updateUserPreferences: vi.fn(),
    getLidarrApproveOptions: vi.fn(),
    listTargets: vi.fn(),
    listUsers: vi.fn(),
    updateTargetApi: vi.fn(),
    updateSettings: vi.fn(),
  }
})

const mocked = vi.mocked(api)

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.getUserPreferences.mockResolvedValue({ dismissedHints: [] } as never)
  mocked.updateUserPreferences.mockResolvedValue(undefined as never)
  mocked.getCurrentUser.mockResolvedValue({ id: 1, username: 'admin', isAdmin: true } as never)
  mocked.listUsers.mockResolvedValue([{ id: 1, username: 'admin' }] as never)
  mocked.updateTargetApi.mockResolvedValue(undefined as never)
  mocked.updateSettings.mockResolvedValue({} as never)
})

describe('TargetsTab edit', () => {
  it('sends only form fields so stored booleans keep their type', async () => {
    mocked.listTargets.mockResolvedValue([
      {
        id: 7,
        type: 'jellyfin-playlist',
        name: 'Jelly',
        enabled: true,
        userId: 1,
        owned: true,
        config: { url: 'https://jf.example', apiKey: '***', userId: 'u1', skipTlsVerify: false },
      },
    ] as never)

    renderWithQuery(<TargetsTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(mocked.updateTargetApi).toHaveBeenCalled())
    const body = mocked.updateTargetApi.mock.calls[0]?.[1]
    expect(body?.config).toEqual({ url: 'https://jf.example', userId: 'u1' })
    expect(body?.config).not.toHaveProperty('skipTlsVerify')
  })

  it('lets an auto-created Spotify playlist target be renamed', async () => {
    mocked.listTargets.mockResolvedValue([
      {
        id: 9,
        type: 'spotify-playlist',
        name: 'Spotify',
        enabled: true,
        userId: 1,
        owned: true,
        config: {},
      },
    ] as never)

    renderWithQuery(<TargetsTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByDisplayValue('Spotify'), {
      target: { value: 'My Spotify' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(mocked.updateTargetApi).toHaveBeenCalledWith(9, {
        name: 'My Spotify',
        enabled: true,
        userId: 1,
      }),
    )
  })
})

describe('LidarrPreferencesSection', () => {
  it('loads picker options from the non-admin approve-options endpoint', async () => {
    mocked.getCurrentUser.mockResolvedValue({ id: 2, username: 'user', isAdmin: false } as never)
    mocked.getLidarrApproveOptions.mockResolvedValue({
      qualityProfiles: [{ id: 3, name: 'Lossless' }],
      metadataProfiles: [{ id: 4, name: 'Standard' }],
      rootFolders: [{ id: 10, path: '/music' }],
    })

    renderWithQuery(<LidarrPreferencesSection />)

    expect(await screen.findByDisplayValue('Lossless')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/music')).toBeInTheDocument()
    expect(mocked.getLidarrApproveOptions).toHaveBeenCalled()
  })
})

describe('NotificationChannelsCard digest schedule', () => {
  it('sends an empty digest cron when the field is cleared', async () => {
    renderWithQuery(
      <NotificationChannelsCard
        settings={{ preferences: { channels: [], digestCron: '0 6 * * 1' } } as never}
        isAdmin
        onSaved={() => {}}
      />,
    )

    // Disclosure panels stay mounted while collapsed, so the field is reachable directly.
    fireEvent.change(screen.getByDisplayValue('0 6 * * 1'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Save', { selector: 'button' }))

    await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
    const prefs = mocked.updateSettings.mock.calls[0]?.[0]?.preferences as Record<string, unknown>
    expect(prefs.digestCron).toBe('')
  })
})

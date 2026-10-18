// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { LidarrPreferencesSection } from '@/web/pages/settings/lidarr-preferences'
import { NotificationChannelsCard } from '@/web/pages/settings/notification-channels'
import { ScheduleTab } from '@/web/pages/settings/schedule-tab'
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

describe('NotificationChannelsCard', () => {
  const channels = [
    { id: 'a', type: 'webhook', url: 'https://hooks.example.com/x', enabled: true, events: [] },
    { id: 'b', type: 'telegram', botToken: '***', chatId: '42', enabled: false, events: [] },
  ]

  it('shows a collapsed channel summary', () => {
    renderWithQuery(
      <NotificationChannelsCard
        settings={{ preferences: { channels } } as never}
        isAdmin
        onSaved={() => {}}
      />,
    )

    expect(screen.getByText('2 channels, 1 enabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Notifications/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('keeps approval-failure alerts opt-in inside the expanded channel', async () => {
    renderWithQuery(
      <NotificationChannelsCard
        settings={{ preferences: { channels: [channels[0]] } } as never}
        isAdmin
        onSaved={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    fireEvent.click(screen.getByRole('button', { name: /hooks.example.com/ }))
    const alert = screen.getByRole('checkbox', { name: 'Approval failed' })
    expect(alert).not.toBeChecked()
    fireEvent.click(alert)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
    expect(mocked.updateSettings.mock.calls[0]?.[0]?.preferences).toMatchObject({
      channels: [expect.objectContaining({ id: 'a', events: ['approval_failed'] })],
    })
  })

  it('reveals the type picker only after Add channel', () => {
    renderWithQuery(
      <NotificationChannelsCard
        settings={{ preferences: { channels: [] } } as never}
        isAdmin
        onSaved={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.queryByRole('combobox', { name: 'Type' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument()
  })
})

describe('ScheduleTab digest schedule', () => {
  it('saves the digest cron from the Schedule tab', async () => {
    const onSaved = vi.fn()
    renderWithQuery(
      <ScheduleTab
        settings={
          {
            preferences: { scheduleCron: '0 0 * * *', digestCron: '0 6 * * 1' },
            librarySyncIntervalHours: 6,
          } as never
        }
        onSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByDisplayValue('0 6 * * 1'), { target: { value: '0 7 * * 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
    const prefs = mocked.updateSettings.mock.calls[0]?.[0]?.preferences as Record<string, unknown>
    expect(prefs.digestCron).toBe('0 7 * * 1')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})

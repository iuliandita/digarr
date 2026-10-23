// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { LidarrPreferencesSection } from '@/web/pages/settings/lidarr-preferences'
import { NotificationChannelsCard } from '@/web/pages/settings/notification-channels'
import { ScheduleTab } from '@/web/pages/settings/schedule-tab'
import { TargetsTab } from '@/web/pages/settings/targets-tab'
import { createTestQueryClient } from '../../helpers/query'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getAuthStatus: vi.fn(),
    getSubscriptions: vi.fn(),
    getPlaylists: vi.fn(),
    getSchedulerInfo: vi.fn(),
    getPlaylistScheduler: vi.fn(),
    getUserPreferences: vi.fn(),
    updateUserPreferences: vi.fn(),
    getLidarrApproveOptions: vi.fn(),
    listTargets: vi.fn(),
    listUsers: vi.fn(),
    updateTargetApi: vi.fn(),
    updateSettings: vi.fn(),
    updatePersonalNotificationChannels: vi.fn().mockResolvedValue(undefined),
  }
})

const mocked = vi.mocked(api)

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.getAuthStatus.mockResolvedValue({ isAdmin: true } as never)
  mocked.getSubscriptions.mockResolvedValue([])
  mocked.getPlaylists.mockResolvedValue([])
  mocked.getSchedulerInfo.mockResolvedValue({ jobs: [] })
  mocked.getPlaylistScheduler.mockResolvedValue({ enabled: false, nextRun: null, cron: null })
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
    fireEvent.click(screen.getByRole('button', { name: /hooks\.example\.com/ }))
    const alert = screen.getByRole('checkbox', { name: 'Approval failed' })
    expect(alert).not.toBeChecked()
    fireEvent.click(alert)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
    expect(mocked.updateSettings.mock.calls[0]?.[0]?.preferences).toMatchObject({
      channels: [expect.objectContaining({ id: 'a', events: ['approval_failed'] })],
    })
  })

  it('sends "" for a saved optional secret marked for removal and offers no removal for a required one', async () => {
    const saved = [
      { ...channels[0], signingSecret: '***' },
      { ...channels[1], enabled: true },
    ]
    renderWithQuery(
      <NotificationChannelsCard
        settings={{ preferences: { channels: saved } } as never}
        isAdmin
        onSaved={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    fireEvent.click(screen.getByRole('button', { name: /hooks\.example\.com/ }))
    fireEvent.click(screen.getByRole('button', { name: /42/ }))
    const sign = screen.getByLabelText('Signing secret (optional)').parentElement as HTMLElement
    const bot = screen.getByLabelText('Bot token').parentElement as HTMLElement
    expect(within(bot).getByText('Saved')).toBeInTheDocument()
    expect(within(bot).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    fireEvent.click(within(sign).getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Will be removed when you save')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
    const sent = mocked.updateSettings.mock.calls.at(-1)?.[0] as {
      preferences: { channels: unknown[] }
    }
    expect(sent.preferences.channels).toEqual([
      expect.objectContaining({ id: 'a', signingSecret: '' }),
      expect.objectContaining({ id: 'b', botToken: '***' }),
    ])
  })

  it('lets a non-admin opt in to personal request outcomes without global controls', async () => {
    renderWithQuery(
      <NotificationChannelsCard
        personal
        isAdmin={false}
        settings={{ preferences: { channels: [channels[0]] } } as never}
        onSaved={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    fireEvent.click(screen.getByRole('button', { name: /hooks\.example\.com/ }))
    const event = screen.getByRole('checkbox', { name: 'Request resolved' })
    expect(event).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Approval failed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Advanced' })).not.toBeInTheDocument()
    fireEvent.click(event)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocked.updatePersonalNotificationChannels).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'a',
          events: ['request_resolved'],
          allowPrivateTarget: false,
        }),
      ]),
    )
    expect(mocked.updateSettings).not.toHaveBeenCalled()
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
  it.each(['0 7 * * 1', ''])(
    'saves the digest cron %j from the Schedule tab',
    async (digestCron) => {
      const onSaved = vi.fn()
      renderWithQuery(
        <ScheduleTab
          isAdmin
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
      fireEvent.change(screen.getByDisplayValue('0 6 * * 1'), { target: { value: digestCron } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalled())
      const prefs = mocked.updateSettings.mock.calls[0]?.[0]?.preferences as Record<string, unknown>
      expect(prefs.digestCron).toBe(digestCron)
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
    },
  )
})

describe('ScheduleTab overview', () => {
  it('lists schedules and edit destinations without exposing global controls to members', async () => {
    mocked.getAuthStatus.mockResolvedValue({ isAdmin: false } as never)
    mocked.getSubscriptions.mockResolvedValue([
      { id: 11, name: 'Weekly jazz', cron: '0 8 * * 1', enabled: true },
      { id: 12, name: 'Paused rock', cron: '0 9 * * 2', enabled: false },
    ] as never)
    mocked.getSchedulerInfo.mockResolvedValue({
      jobs: [
        { name: 'subscription-11', expression: '0 8 * * 1', nextRun: '2026-10-19T08:00:00.000Z' },
      ],
    })
    mocked.getPlaylists.mockResolvedValue([
      { id: 21, name: 'Daily mix', schedule: '0 7 * * *' },
      { id: 22, name: 'Manual mix', schedule: null },
    ] as never)

    renderWithQuery(
      <ScheduleTab
        settings={{ preferences: { scheduleCron: '0 5 * * *', digestCron: '0 6 * * 1' } }}
        onSaved={vi.fn()}
      />,
    )

    expect(await screen.findByText('Weekly jazz')).toBeInTheDocument()
    expect(screen.getByText('Paused rock')).toBeInTheDocument()
    expect(await screen.findByText('Daily mix')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('0 5 * * *')).toBeInTheDocument()
    expect(screen.getByText('0 6 * * 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit: Weekly jazz' })).toHaveAttribute(
      'href',
      '/discovery-modes?subscription=11',
    )
    expect(screen.getByRole('link', { name: 'Edit: Daily mix' })).toHaveAttribute(
      'href',
      '/playlists',
    )
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mocked.updateSettings).not.toHaveBeenCalled()
  })

  it('keeps the admin playlist scheduling switch in the overview', async () => {
    renderWithQuery(
      <ScheduleTab
        isAdmin
        settings={{ preferences: { playlistEnabled: false } }}
        onSaved={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('switch', { name: 'Scheduled generation' }))
    await waitFor(() =>
      expect(mocked.updateSettings).toHaveBeenCalledWith({
        preferences: { playlistEnabled: true },
      }),
    )
  })

  it('keeps available schedules visible when another schedule source fails', async () => {
    mocked.getSubscriptions.mockRejectedValue(new Error('unavailable'))
    mocked.getPlaylists.mockResolvedValue([
      { id: 21, name: 'Daily mix', schedule: '0 7 * * *' },
    ] as never)

    renderWithQuery(
      <ScheduleTab settings={{ preferences: { scheduleCron: '0 5 * * *' } }} onSaved={vi.fn()} />,
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByText('Daily mix')).toBeInTheDocument()
    expect(screen.getByText('0 5 * * *')).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '@/db/schema'
import * as api from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { ConnectionsTab } from '@/web/pages/settings/connections-tab'
import type { Settings } from '@/web/pages/settings/types'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/web/lib/api')>()),
  getCurrentUser: vi.fn(),
  getDashboardGenreCoverage: vi.fn().mockResolvedValue({ totalArtists: 0 }),
  getUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
  getOAuthStatus: vi.fn(),
  disconnectOAuth: vi.fn(),
  getPlexSections: vi.fn().mockResolvedValue({ sections: [] }),
  getLidarrApproveOptions: vi
    .fn()
    .mockResolvedValue({ qualityProfiles: [], metadataProfiles: [], rootFolders: [] }),
  updateSettings: vi.fn(),
  testService: vi.fn(),
}))
const mocked = vi.mocked(api)

function mount(initial: Settings = {}) {
  let stored = initial
  mocked.updateSettings.mockImplementation(async (body) => {
    stored = {
      ...stored,
      ...body,
      preferences: { ...stored.preferences, ...(body.preferences as object) },
    } as Settings
    return stored as Record<string, unknown>
  })
  function Harness() {
    const [settings, setSettings] = useState(initial)
    return <ConnectionsTab settings={settings} onSaved={() => setSettings(stored)} />
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.getCurrentUser.mockResolvedValue({ id: 1, isAdmin: true } as never)
  mocked.getUserPreferences.mockResolvedValue({ ...DEFAULT_PREFERENCES })
  mocked.updateUserPreferences.mockResolvedValue({ success: true })
  mocked.getOAuthStatus.mockImplementation(async (provider) => ({
    connected: provider === 'spotify',
    scopes: null,
  }))
})

async function openPicker() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
  return screen.getByRole('region', { name: 'Add connection' })
}

describe('Connections picker', () => {
  it('lists only saved credentials or OAuth links, including incomplete credentials', async () => {
    mount({ listenbrainzUsername: 'unfinished', plexToken: '***' })
    expect(await screen.findByRole('group', { name: /^Spotify/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^ListenBrainz/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^Plex/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Last.fm/ })).toBeNull()
    expect(document.getElementById('lfm-username')).toBeNull()
    const picker = await openPicker()
    expect(within(picker).queryByRole('button', { name: 'Spotify' })).toBeNull()
    expect(within(picker).queryByRole('button', { name: 'ListenBrainz' })).toBeNull()
    expect(within(picker).getByRole('button', { name: 'Last.fm' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search connections' })).toHaveFocus(),
    )
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Add connection' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add connection' })).toHaveFocus(),
    )
  })

  it('filters live, opens the existing form, preserves a failed save, then lists and removes it', async () => {
    mount()
    const picker = await openPicker()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'release radar' } })
    expect(within(picker).queryByRole('button', { name: 'Plex' })).toBeNull()
    fireEvent.click(within(picker).getByRole('button', { name: 'Last.fm' }))
    const username = screen.getByLabelText('Username')
    await waitFor(() => expect(username).toHaveFocus())
    fireEvent.change(username, { target: { value: 'listener' } })
    const anotherPicker = await openPicker()
    fireEvent.click(within(anotherPicker).getByRole('button', { name: 'Last.fm' }))
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus())
    const form = screen.getByRole('group', { name: /^Last.fm/ })
    mocked.updateSettings.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(screen.getByLabelText('Username')).toHaveValue('listener')
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull())
    expect(mocked.updateSettings).toHaveBeenLastCalledWith({
      lastfmUsername: 'listener',
      lastfmApiKey: undefined,
    })
    const saved = screen.getByRole('group', { name: /^Last.fm/ })
    await waitFor(() =>
      expect(within(saved).getByRole('button', { expanded: false })).toHaveFocus(),
    )
    const reopened = await openPicker()
    expect(within(reopened).queryByRole('button', { name: 'Last.fm' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    fireEvent.click(within(saved).getByRole('button', { expanded: false }))
    fireEvent.click(within(saved).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Last.fm/ })).toBeNull())
    expect(mocked.updateSettings).toHaveBeenLastCalledWith({
      lastfmUsername: null,
      lastfmApiKey: null,
    })
    const afterRemoval = await openPicker()
    fireEvent.click(within(afterRemoval).getByRole('button', { name: 'Last.fm' }))
    expect(screen.getByLabelText('Username')).toHaveValue('')
  })

  it('offers AudioMuse only to admins with experimental integrations visible, then saves, tests, and disconnects', async () => {
    mount()
    const picker = await openPicker()
    expect(within(picker).queryByRole('button', { name: 'AudioMuse-AI' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Show experimental integrations/ }))
    const choice = await within(picker).findByRole('button', { name: 'AudioMuse-AI' })
    fireEvent.click(choice)
    const form = screen.getByRole('group', { name: /^AudioMuse-AI/ })
    expect(within(form).getByText('Experimental')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://audiomuse.example' },
    })
    fireEvent.change(screen.getByLabelText('API token (optional)'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByLabelText('Skip TLS verification'))
    mocked.testService.mockResolvedValueOnce({ message: 'AudioMuse-AI' })
    fireEvent.click(within(form).getByRole('button', { name: 'Test Connection' }))
    await waitFor(() =>
      expect(mocked.testService).toHaveBeenCalledWith('audiomuse', {
        url: 'https://audiomuse.example',
        token: 'secret',
        skipTlsVerify: true,
      }),
    )
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocked.updateSettings).toHaveBeenLastCalledWith({
        preferences: {
          audiomuseUrl: 'https://audiomuse.example',
          audiomuseToken: 'secret',
          audiomuseSkipTlsVerify: true,
        },
      }),
    )
    const saved = screen.getByRole('group', { name: /^AudioMuse-AI/ })
    await waitFor(() =>
      expect(within(saved).getByRole('button', { expanded: false })).toBeInTheDocument(),
    )
    fireEvent.click(within(saved).getByRole('button', { expanded: false }))
    fireEvent.click(within(saved).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: /^AudioMuse-AI/ })).toBeNull())
    expect(mocked.updateSettings).toHaveBeenLastCalledWith({
      preferences: { audiomuseUrl: '', audiomuseToken: '', audiomuseSkipTlsVerify: false },
    })
  })

  it('returns a disconnected OAuth service to the picker', async () => {
    mount()
    const spotify = await screen.findByRole('group', { name: /^Spotify/ })
    fireEvent.click(within(spotify).getByRole('button', { expanded: false }))
    mocked.disconnectOAuth.mockImplementation(async () => {
      mocked.getOAuthStatus.mockResolvedValue({ connected: false, scopes: null })
    })
    fireEvent.click(within(spotify).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Spotify/ })).toBeNull())
    const picker = await openPicker()
    expect(within(picker).getByRole('button', { name: 'Spotify' })).toBeInTheDocument()
  })

  it('hides configured TIDAL rows until the admin enables experimental integrations', async () => {
    mocked.getOAuthStatus.mockResolvedValue({ connected: true, scopes: null })
    mount({ tidalClientId: 'app', tidalClientSecret: '***', _tidalAppConfigured: true })
    await screen.findByRole('group', { name: /^Spotify/ })
    expect(screen.queryByRole('group', { name: /TIDAL/ })).toBeNull()
    const picker = await openPicker()
    expect(within(picker).queryByRole('button', { name: /TIDAL/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Show experimental integrations/ }))
    await waitFor(() => expect(screen.getAllByRole('group', { name: /TIDAL/ })).toHaveLength(2))
    expect(mocked.updateSettings).toHaveBeenCalledWith({
      preferences: { showExperimentalIntegrations: true },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Show experimental integrations/ }))
    await waitFor(() => expect(screen.queryByRole('group', { name: /TIDAL/ })).toBeNull())
    expect(mocked.updateSettings).toHaveBeenLastCalledWith({
      preferences: { showExperimentalIntegrations: false },
    })
  })

  it('keeps server rows read-only for members and hides the experimental toggle', async () => {
    mocked.getCurrentUser.mockResolvedValue({ id: 2, isAdmin: false } as never)
    mount({
      lidarrUrl: 'https://library.example',
      aiModel: 'saved',
      _notificationsConfigured: true,
    })
    await screen.findAllByText('Only admins can modify global settings.')
    const picker = await openPicker()
    expect(within(picker).queryByRole('checkbox')).toBeNull()
    expect(within(picker).queryByRole('button', { name: 'Lidarr' })).toBeNull()
    expect(within(picker).queryByRole('button', { name: 'AudioMuse-AI' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    const images = await screen.findByRole('group', { name: 'Artist images' })
    fireEvent.click(within(images).getByRole('button'))
    expect(within(images).queryByRole('textbox')).toBeNull()
    expect(within(images).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(document.getElementById('lidarr-url')).toBeNull()
    expect(mocked.updateSettings).not.toHaveBeenCalled()
  })
})

describe('Artist images', () => {
  it.each([false, true])(
    'saves the existing keys and updates the proxy only after server success (failure: %s)',
    async (failServer) => {
      mount({ audiodbApiKey: '***', audiodbProxyImages: false, wikidataEnabled: true })
      const card = await screen.findByRole('group', { name: 'Artist images' })
      fireEvent.click(within(card).getByRole('button'))
      fireEvent.change(screen.getByLabelText('TheAudioDB premium API key (optional)'), {
        target: { value: 'audio-key' },
      })
      fireEvent.change(screen.getByLabelText('Fanart.tv API key (optional)'), {
        target: { value: 'fanart-key' },
      })
      fireEvent.change(screen.getByLabelText('Metadata fallback URL (optional)'), {
        target: { value: 'https://images.example' },
      })
      fireEvent.click(screen.getByLabelText(/Proxy images through Digarr/))
      fireEvent.click(
        screen.getByLabelText('Show artist bio and external links on recommendation cards'),
      )
      if (failServer) mocked.updateSettings.mockRejectedValueOnce(new Error('offline'))
      fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled())
      expect(mocked.updateUserPreferences).toHaveBeenCalledWith({
        fanartApiKey: 'fanart-key',
        metadataFallbackUrl: 'https://images.example',
      })
      expect(mocked.updateSettings).toHaveBeenCalledWith({
        audiodbApiKey: 'audio-key',
        audiodbProxyImages: true,
        wikidataEnabled: false,
      })
      expect(localStorage.getItem('digarr:audiodbProxyImages')).toBe(failServer ? '0' : '1')
    },
  )
})

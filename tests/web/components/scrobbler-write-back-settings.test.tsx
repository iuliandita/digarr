// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthCallbackNotice, resolveOAuthNotice } from '@/web/components/oauth-callback-notice'
import {
  LastfmWriteBack,
  ListenBrainzWriteBack,
} from '@/web/components/scrobbler-write-back-settings'
import {
  getScrobblerWriteBackStatus,
  getUserPreferences,
  initiateOAuth,
  updateUserPreferences,
} from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  getScrobblerWriteBackStatus: vi.fn(),
  getUserPreferences: vi.fn(),
  initiateOAuth: vi.fn(),
  updateUserPreferences: vi.fn(),
}))

function renderSettings(search = '') {
  const client = createTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/settings?tab=connections${search}`]}>
        <I18nProvider>
          <OAuthCallbackNotice />
          <ListenBrainzWriteBack />
          <LastfmWriteBack />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const configuredStatus = {
  listenbrainz: { configured: true, lastError: null },
  lastfm: { configured: true, connected: true, lastError: null },
}

describe('scrobbler write-back cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getScrobblerWriteBackStatus).mockResolvedValue(configuredStatus)
    vi.mocked(getUserPreferences).mockResolvedValue({})
    vi.mocked(updateUserPreferences).mockResolvedValue({})
  })

  it('saves each independent opt-in without enabling the other sends', async () => {
    renderSettings()
    const loves = await screen.findByRole('checkbox', { name: 'Send track loves to ListenBrainz' })
    const playlists = screen.getByRole('checkbox', {
      name: 'Send generated playlists to ListenBrainz',
    })
    const lastfm = screen.getByRole('checkbox', { name: 'Send track loves to Last.fm' })
    expect(loves).not.toBeChecked()
    expect(playlists).not.toBeChecked()
    expect(lastfm).not.toBeChecked()
    fireEvent.click(loves)
    await waitFor(() => expect(loves).toBeChecked())
    expect(updateUserPreferences).toHaveBeenLastCalledWith({ listenbrainzLoveEnabled: true })
    expect(playlists).not.toBeChecked()
    fireEvent.click(playlists)
    await waitFor(() => expect(playlists).toBeChecked())
    expect(updateUserPreferences).toHaveBeenLastCalledWith({ listenbrainzPlaylistEnabled: true })
    expect(lastfm).not.toBeChecked()
    fireEvent.click(lastfm)
    await waitFor(() => expect(lastfm).toBeChecked())
    expect(updateUserPreferences).toHaveBeenLastCalledWith({ lastfmLoveEnabled: true })
    fireEvent.click(loves)
    await waitFor(() => expect(loves).not.toBeChecked())
    expect(updateUserPreferences).toHaveBeenLastCalledWith({ listenbrainzLoveEnabled: false })
    expect(screen.getAllByText(/does not undo anything already sent/)).toHaveLength(2)
    expect(
      screen.getAllByText(/Rejections, blocks, and artist-only approvals stay local/),
    ).toHaveLength(2)
  })

  it('explains missing credentials and permits disabling an existing opt-in', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({ lastfmLoveEnabled: true })
    vi.mocked(getScrobblerWriteBackStatus).mockResolvedValue({
      listenbrainz: { configured: false, lastError: null },
      lastfm: { configured: false, connected: false, lastError: null },
    })
    renderSettings()
    expect(
      await screen.findByRole('checkbox', { name: 'Send track loves to ListenBrainz' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: 'Send generated playlists to ListenBrainz' }),
    ).toBeDisabled()
    expect(screen.getByText(/LASTFM_SHARED_SECRET and DIGARR_ENCRYPTION_KEY/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send track loves to Last.fm' }))
    await waitFor(() =>
      expect(updateUserPreferences).toHaveBeenCalledWith({ lastfmLoveEnabled: false }),
    )
  })

  it('starts OAuth with an empty body without enabling sends before connection', async () => {
    vi.mocked(getScrobblerWriteBackStatus).mockResolvedValue({
      ...configuredStatus,
      lastfm: { configured: true, connected: false, lastError: null },
    })
    vi.mocked(initiateOAuth).mockImplementation(() => new Promise(() => {}))
    renderSettings()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Send track loves to Last.fm' }))
    await waitFor(() => expect(initiateOAuth).toHaveBeenCalledWith('lastfm', {}))
    expect(updateUserPreferences).not.toHaveBeenCalled()
    expect(screen.getByText(/After returning, turn the switch on again/)).toBeInTheDocument()
  })

  it('shows connection success and send failures while requiring explicit enable', async () => {
    vi.mocked(getScrobblerWriteBackStatus).mockResolvedValue({
      listenbrainz: { configured: true, lastError: 'upstream unavailable' },
      lastfm: { configured: true, connected: true, lastError: 'authorization rejected' },
    })
    expect(resolveOAuthNotice({ success: 'lastfm' })).toEqual({
      kind: 'success',
      providerLabel: 'Last.fm',
    })
    renderSettings('&oauth_success=lastfm')
    expect(await screen.findByText('Last send error: upstream unavailable')).toBeInTheDocument()
    expect(screen.getByText('Last send error: authorization rejected')).toBeInTheDocument()
    expect(
      screen.getByText(/Last.fm is connected. Turn on track loves explicitly/),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Send track loves to Last.fm' })).not.toBeChecked()
    expect(updateUserPreferences).not.toHaveBeenCalled()
  })

  it('reconnects a revoked stored session without changing sending preferences', async () => {
    vi.mocked(getScrobblerWriteBackStatus).mockResolvedValue({
      ...configuredStatus,
      lastfm: { configured: true, connected: true, lastError: 'session revoked' },
    })
    vi.mocked(getUserPreferences).mockResolvedValue({ lastfmLoveEnabled: true })
    vi.mocked(initiateOAuth).mockImplementation(() => new Promise(() => {}))
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Last.fm' }))
    await waitFor(() => expect(initiateOAuth).toHaveBeenCalledWith('lastfm', {}))
    expect(updateUserPreferences).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Send track loves to Last.fm' })).toBeChecked()
  })

  it('shows load failures and retries both settings requests', async () => {
    vi.mocked(getScrobblerWriteBackStatus).mockRejectedValueOnce(new Error('unavailable'))
    renderSettings()
    const alerts = await screen.findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('Could not load your write-back settings.')
    const [retry] = screen.getAllByRole('button', { name: 'Try again' })
    fireEvent.click(retry as HTMLElement)
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Send track loves to Last.fm' })).toBeEnabled(),
    )
    expect(getScrobblerWriteBackStatus).toHaveBeenCalledTimes(2)
    expect(getUserPreferences).toHaveBeenCalledTimes(2)
  })
})

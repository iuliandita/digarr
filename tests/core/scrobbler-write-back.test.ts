import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createListenBrainzPlaylist,
  loveLastFm,
  loveListenBrainz,
} from '@/core/clients/scrobbler-write-back'
import { createScrobblerWriteBack } from '@/core/scrobbler-write-back'
import type { OAuthTokenRow } from '@/db/queries/oauth-tokens'
import type { UserConnections } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'

vi.mock('@/core/clients/scrobbler-write-back', () => ({
  loveListenBrainz: vi.fn(async () => {}),
  loveLastFm: vi.fn(async () => {}),
  createListenBrainzPlaylist: vi.fn(async () => {}),
}))

const track = {
  artistName: 'Portishead',
  trackName: 'Roads',
  recordingMbid: 'df523108-2308-4bb5-8972-7185bcbbbd45',
}

function setup(preferences: Partial<Preferences> | null = null) {
  const deps = {
    getPreferences: vi.fn(async () => preferences),
    getConnections: vi.fn(
      async () => ({ listenbrainzToken: 'lb-secret', lastfmApiKey: 'lfm-key' }) as UserConnections,
    ),
    getLastFmSession: vi.fn(
      async () =>
        ({
          accessToken: 'lfm-session',
          clientId: 'lfm-key',
          clientSecret: 'lfm-secret',
        }) as OAuthTokenRow,
    ),
    recorder: {
      start: vi.fn(async () => 99),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      markStuck: vi.fn(async () => 0),
    },
    lastfmSharedSecret: () => 'lfm-secret',
    encryptionEnabled: () => true,
  }
  return { deps, service: createScrobblerWriteBack(deps) }
}

beforeEach(() => vi.clearAllMocks())

describe('opt-in scrobbler write-back', () => {
  it.each([null, {}, { scoreThreshold: 0.7 }])('keeps upgraded users off for %j', async (prefs) => {
    const { service, deps } = setup(prefs)
    await service.approvedTrack(7, track)
    await service.generatedPlaylist(
      7,
      'New music',
      [{ ...track, mbid: track.recordingMbid }],
      'manual',
    )
    expect(loveListenBrainz).not.toHaveBeenCalled()
    expect(loveLastFm).not.toHaveBeenCalled()
    expect(createListenBrainzPlaylist).not.toHaveBeenCalled()
    expect(deps.getConnections).not.toHaveBeenCalled()
  })

  it.each([
    [{ listenbrainzLoveEnabled: true }, true, false],
    [{ lastfmLoveEnabled: true }, false, true],
    [{ listenbrainzLoveEnabled: true, lastfmLoveEnabled: true }, true, true],
  ] as const)('sends only opted-in services for %j', async (prefs, lb, lfm) => {
    const { service, deps } = setup(prefs)
    await service.approvedTrack(7, track)
    expect(loveListenBrainz).toHaveBeenCalledTimes(lb ? 1 : 0)
    expect(loveLastFm).toHaveBeenCalledTimes(lfm ? 1 : 0)
    if (lb) expect(loveListenBrainz).toHaveBeenCalledWith('lb-secret', track.recordingMbid)
    if (lfm)
      expect(loveLastFm).toHaveBeenCalledWith({
        apiKey: 'lfm-key',
        sharedSecret: 'lfm-secret',
        sessionKey: 'lfm-session',
        artistName: track.artistName,
        trackName: track.trackName,
      })
    expect(deps.recorder.complete).toHaveBeenCalled()
  })

  it('requires an MBID for ListenBrainz and an exact track for Last.fm', async () => {
    const { service } = setup({ listenbrainzLoveEnabled: true, lastfmLoveEnabled: true })
    await service.approvedTrack(7, { artistName: 'Portishead', trackName: '' })
    expect(loveLastFm).not.toHaveBeenCalled()
    await service.approvedTrack(7, { artistName: track.artistName, trackName: track.trackName })
    expect(loveListenBrainz).not.toHaveBeenCalled()
    expect(loveLastFm).toHaveBeenCalledTimes(1)
  })

  it('keeps playlist export independent of loves', async () => {
    const { service } = setup({ listenbrainzLoveEnabled: true })
    await service.generatedPlaylist(
      7,
      'New music',
      [{ ...track, mbid: track.recordingMbid }],
      'manual',
    )
    expect(createListenBrainzPlaylist).not.toHaveBeenCalled()
    const enabled = setup({ listenbrainzPlaylistEnabled: true }).service
    await enabled.generatedPlaylist(
      7,
      'New music',
      [{ ...track, mbid: track.recordingMbid }],
      'manual',
    )
    expect(createListenBrainzPlaylist).toHaveBeenCalledTimes(1)
    expect(loveListenBrainz).not.toHaveBeenCalled()
    expect(loveLastFm).not.toHaveBeenCalled()
  })

  it('does not push scheduled playlist generations even when opted in', async () => {
    const { service, deps } = setup({ listenbrainzPlaylistEnabled: true })
    await service.generatedPlaylist(
      7,
      'New music',
      [{ ...track, mbid: track.recordingMbid }],
      'scheduled',
    )
    expect(createListenBrainzPlaylist).not.toHaveBeenCalled()
    expect(deps.getPreferences).not.toHaveBeenCalled()
    expect(deps.getConnections).not.toHaveBeenCalled()
    expect(deps.recorder.start).not.toHaveBeenCalled()
  })

  it('rechecks consent after credentials load', async () => {
    const { service, deps } = setup({ listenbrainzLoveEnabled: true })
    deps.getPreferences
      .mockResolvedValueOnce({ listenbrainzLoveEnabled: true })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ listenbrainzLoveEnabled: false })
    await service.approvedTrack(7, track)
    expect(loveListenBrainz).not.toHaveBeenCalled()
    expect(deps.recorder.cancel).toHaveBeenCalledWith(99)
  })

  it('records redacted failures without rejecting the approval work', async () => {
    const { service, deps } = setup({ listenbrainzLoveEnabled: true, lastfmLoveEnabled: true })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loveListenBrainz).mockRejectedValueOnce(new Error('rejected lb-secret'))
    await expect(service.approvedTrack(7, track)).resolves.toBeUndefined()
    expect(deps.recorder.fail).toHaveBeenCalledWith(99, 'rejected [redacted]')
    expect(loveLastFm).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.flat().join(' ')).not.toContain('lb-secret')
    log.mockRestore()
  })
})

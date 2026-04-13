import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import type { DiscoveryModeDefinition } from '@/core/discovery-modes/types'
import type { UserConnections } from '@/db/queries/users'

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

vi.mock('@/core/discovery-modes/modes/runtime', () => ({
  getDiscoveryModeConnections: vi.fn(),
  getNormalizedLimit: vi.fn(),
  normalizeDiscoveryName: vi.fn((name: string) => name.toLowerCase()),
}))

import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createListenBrainzRadioModes } from '@/core/discovery-modes/modes/listenbrainz'
import {
  getDiscoveryModeConnections,
  getNormalizedLimit,
} from '@/core/discovery-modes/modes/runtime'

const mockClient = {
  getArtistRadio: vi.fn(),
  getUserRadio: vi.fn(),
  getSimilarUsers: vi.fn(),
  getTopArtistsForUser: vi.fn(),
  getTopArtists: vi.fn(),
  getSimilarArtists: vi.fn(),
  getListenCount: vi.fn(),
  getListeningActivity: vi.fn(),
  getTagRadio: vi.fn(),
  testConnection: vi.fn(),
}

const baseConnections: UserConnections = {
  listenbrainzUsername: null,
  listenbrainzToken: null,
  lastfmUsername: null,
  lastfmApiKey: null,
  plexUrl: null,
  plexToken: null,
  jellyfinUrl: null,
  jellyfinApiKey: null,
  jellyfinUserId: null,
  embyUrl: null,
  embyApiKey: null,
  embyUserId: null,
  discogsToken: null,
  discogsUsername: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createListenBrainzClient).mockReturnValue(mockClient)
  const connections: UserConnections = {
    ...baseConnections,
    listenbrainzUsername: 'testuser',
    listenbrainzToken: 'testtoken',
  }
  vi.mocked(getDiscoveryModeConnections).mockResolvedValue(connections)
  vi.mocked(getNormalizedLimit).mockReturnValue(25)
})

function getMode(modes: DiscoveryModeDefinition[], id: string): DiscoveryModeDefinition {
  const mode = modes.find((entry) => entry.id === id)
  if (!mode) {
    throw new Error(`Mode not found in test: ${id}`)
  }

  return mode
}

function makeRequest(
  modeId: string,
  settingsMode: DiscoveryModeRequest['settingsMode'],
  normalizedSettings: Record<string, unknown>,
): DiscoveryModeRequest {
  return {
    modeId,
    triggerType: 'manual',
    settingsMode,
    userId: 1,
    rawUserSettings: normalizedSettings,
    normalizedSettings,
    providerContext: { providerPath: ['listenbrainz'] },
    fallbackPolicy: 'strict',
  }
}

describe('lb-artist-radio mode', () => {
  it('calls getArtistRadio and maps candidates', async () => {
    mockClient.getArtistRadio.mockResolvedValueOnce([
      { name: 'Found Artist', mbid: 'mbid-1', score: 0.9 },
      { name: 'Another Artist', mbid: 'mbid-2', score: 0.7 },
    ])

    const modes = createListenBrainzRadioModes()
    const artistRadio = getMode(modes, 'lb-artist-radio')

    const result = await artistRadio.executor(
      makeRequest('lb-artist-radio', 'easy', {
        seedArtistMbid: 'seed-mbid',
        adventurousness: 'medium',
      }),
    )

    expect(mockClient.getArtistRadio).toHaveBeenCalledWith('seed-mbid', 'medium')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toMatchObject({
      candidateType: 'artist',
      name: 'Found Artist',
      mbid: 'mbid-1',
      provenanceProvider: 'listenbrainz:artist-radio',
    })
  })

  it('throws when LB not connected', async () => {
    const connections: UserConnections = baseConnections
    vi.mocked(getDiscoveryModeConnections).mockResolvedValue(connections)

    const modes = createListenBrainzRadioModes()
    const artistRadio = getMode(modes, 'lb-artist-radio')

    await expect(
      artistRadio.executor(
        makeRequest('lb-artist-radio', 'easy', {
          seedArtistMbid: 'x',
          adventurousness: 'easy',
        }),
      ),
    ).rejects.toThrow('Connect ListenBrainz')
  })
})

describe('lb-user-radio mode', () => {
  it('uses connected username when no target specified', async () => {
    mockClient.getUserRadio.mockResolvedValueOnce([])

    const modes = createListenBrainzRadioModes()
    const userRadio = getMode(modes, 'lb-user-radio')

    await userRadio.executor(
      makeRequest('lb-user-radio', 'advanced', {
        targetUsername: '',
        adventurousness: 'medium',
      }),
    )

    expect(mockClient.getUserRadio).toHaveBeenCalledWith('testuser', 'medium')
  })

  it('uses explicit target username when provided', async () => {
    mockClient.getUserRadio.mockResolvedValueOnce([])

    const modes = createListenBrainzRadioModes()
    const userRadio = getMode(modes, 'lb-user-radio')

    await userRadio.executor(
      makeRequest('lb-user-radio', 'advanced', {
        targetUsername: 'friend',
        adventurousness: 'easy',
      }),
    )

    expect(mockClient.getUserRadio).toHaveBeenCalledWith('friend', 'easy')
  })
})

describe('similar-users-deep mode', () => {
  it('fetches similar users then their top artists', async () => {
    mockClient.getSimilarUsers.mockResolvedValueOnce([
      { username: 'alice', similarity: 0.9 },
      { username: 'bob', similarity: 0.7 },
    ])
    mockClient.getTopArtistsForUser
      .mockResolvedValueOnce([
        { name: 'Alice Pick', mbid: 'mbid-a1', playCount: 100, source: 'listenbrainz' },
        { name: 'Shared Pick', mbid: 'mbid-s1', playCount: 80, source: 'listenbrainz' },
      ])
      .mockResolvedValueOnce([
        { name: 'Bob Pick', mbid: 'mbid-b1', playCount: 90, source: 'listenbrainz' },
        { name: 'Shared Pick', mbid: 'mbid-s1', playCount: 70, source: 'listenbrainz' },
      ])

    const modes = createListenBrainzRadioModes()
    const deep = getMode(modes, 'similar-users-deep')

    const result = await deep.executor(
      makeRequest('similar-users-deep', 'advanced', { maxUsers: 2 }),
    )

    expect(mockClient.getSimilarUsers).toHaveBeenCalled()
    expect(mockClient.getTopArtistsForUser).toHaveBeenCalledTimes(2)
    expect(mockClient.getTopArtistsForUser).toHaveBeenCalledWith('alice', 'month')
    expect(mockClient.getTopArtistsForUser).toHaveBeenCalledWith('bob', 'month')

    const names = result.candidates.map((c) => c.name)
    expect(names).toContain('Alice Pick')
    expect(names).toContain('Bob Pick')
    expect(names).toContain('Shared Pick')
    // Shared Pick should appear only once (deduplicated)
    expect(names.filter((n) => n === 'Shared Pick')).toHaveLength(1)
  })

  it('caps at maxUsers parameter', async () => {
    mockClient.getSimilarUsers.mockResolvedValueOnce([
      { username: 'alice', similarity: 0.9 },
      { username: 'bob', similarity: 0.7 },
      { username: 'carol', similarity: 0.5 },
    ])
    mockClient.getTopArtistsForUser.mockResolvedValue([])

    const modes = createListenBrainzRadioModes()
    const deep = getMode(modes, 'similar-users-deep')

    await deep.executor(makeRequest('similar-users-deep', 'advanced', { maxUsers: 2 }))

    expect(mockClient.getTopArtistsForUser).toHaveBeenCalledTimes(2)
  })
})

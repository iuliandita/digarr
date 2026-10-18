// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  chartTopArtists: vi.fn(),
  followedArtists: vi.fn(),
  favoriteArtists: vi.fn(),
  savedAlbums: vi.fn(),
  flowRecommendations: vi.fn(),
  starredArtists: vi.fn(),
  createSubsonicClient: vi.fn(),
  requireToken: vi.fn(),
  getConnections: vi.fn(),
  getSkipTlsVerify: vi.fn(),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(() => ({ getChartTopArtists: m.chartTopArtists })),
}))
vi.mock('@/core/clients/spotify', () => ({
  createSpotifyClient: vi.fn(() => ({
    getFollowedArtists: m.followedArtists,
    getSavedAlbums: m.savedAlbums,
  })),
}))
vi.mock('@/core/clients/tidal-user', () => ({
  createTidalUserClient: vi.fn(() => ({ getFavoriteArtists: m.favoriteArtists })),
}))
vi.mock('@/core/clients/deezer-user', () => ({
  createDeezerUserClient: vi.fn(() => ({ getFlowRecommendations: m.flowRecommendations })),
}))
vi.mock('@/core/clients/subsonic', () => ({ createSubsonicClient: m.createSubsonicClient }))
vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return {
    ...actual,
    requireDiscoveryModeProviderToken: m.requireToken,
    getDiscoveryModeConnections: m.getConnections,
    getDiscoveryModeSkipTlsVerify: m.getSkipTlsVerify,
  }
})

import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createChartsMode } from '@/core/discovery-modes/modes/charts'
import { createDeezerFlowMode } from '@/core/discovery-modes/modes/deezer-flow'
import { createSpotifyFollowedArtistsMode } from '@/core/discovery-modes/modes/spotify-followed-artists'
import { createSpotifySavedAlbumsMode } from '@/core/discovery-modes/modes/spotify-saved-albums'
import { createSubsonicStarredMode } from '@/core/discovery-modes/modes/subsonic-starred'
import { createTidalFavoriteArtistsMode } from '@/core/discovery-modes/modes/tidal-favorite-artists'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(modeId: string, settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId,
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: [] },
    fallbackPolicy: 'allow-fallback',
  }
}

const NAMES = ['Artist A', 'Artist B', 'Artist C']
const FEED = NAMES.map((name, i) => ({ id: String(i), name }))

interface Spec {
  id: string
  create: () => { executor: (req: DiscoveryModeRequest) => Promise<{ candidates: unknown[] }> }
  provider: string
  reason: RegExp
  snapshot: Partial<typeof EMPTY_DISCOVERY_SNAPSHOT>
  clientCall: ReturnType<typeof vi.fn>
  callArgs: (limit: number) => unknown[]
  breakConnection: () => void
  connectError: string | RegExp
}

const rejectToken = (label: string) => () =>
  m.requireToken.mockRejectedValue(new Error(`Connect ${label} to use this mode.`))

const SPECS: Spec[] = [
  {
    id: 'charts',
    create: createChartsMode,
    provider: 'lastfm',
    reason: /last\.fm/i,
    snapshot: { hasLastfm: true },
    clientCall: m.chartTopArtists,
    callArgs: (limit) => [limit, undefined],
    breakConnection: () => m.getConnections.mockResolvedValue({ lastfmApiKey: null }),
    connectError: /last\.fm/i,
  },
  {
    id: 'spotify-followed-artists',
    create: createSpotifyFollowedArtistsMode,
    provider: 'spotify',
    reason: /spotify/i,
    snapshot: { hasSpotify: true, spotifyScopes: ['user-follow-read'] },
    clientCall: m.followedArtists,
    callArgs: (limit) => [limit],
    breakConnection: rejectToken('Spotify'),
    connectError: 'Connect Spotify to use this mode.',
  },
  {
    id: 'tidal-favorite-artists',
    create: createTidalFavoriteArtistsMode,
    provider: 'tidal',
    reason: /tidal/i,
    snapshot: { hasTidal: true },
    clientCall: m.favoriteArtists,
    callArgs: (limit) => [limit],
    breakConnection: rejectToken('TIDAL'),
    connectError: 'Connect TIDAL to use this mode.',
  },
  {
    id: 'spotify-saved-albums',
    create: createSpotifySavedAlbumsMode,
    provider: 'spotify',
    reason: /spotify/i,
    snapshot: { hasSpotify: true },
    clientCall: m.savedAlbums,
    callArgs: (limit) => [limit],
    breakConnection: rejectToken('Spotify'),
    connectError: 'Connect Spotify to use this mode.',
  },
  {
    id: 'deezer-flow',
    create: createDeezerFlowMode,
    provider: 'deezer',
    reason: /deezer/i,
    snapshot: { hasDeezer: true },
    clientCall: m.flowRecommendations,
    callArgs: (limit) => [limit],
    breakConnection: rejectToken('Deezer'),
    connectError: 'Connect Deezer to use this mode.',
  },
]

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.requireToken.mockResolvedValue('valid-token')
  m.getConnections.mockResolvedValue({
    lastfmUsername: 'testuser',
    lastfmApiKey: 'apikey123',
    subsonicUrl: 'https://music.example.com',
    subsonicUsername: 'alice',
    subsonicPassword: 'secret',
  })
  m.getSkipTlsVerify.mockResolvedValue(false)
  m.createSubsonicClient.mockImplementation(() => ({ getStarredArtists: m.starredArtists }))
  for (const spec of SPECS) spec.clientCall.mockResolvedValue(FEED)
  m.starredArtists.mockResolvedValue(FEED)
})

function expectArtistCandidates(candidates: unknown[], provider: string) {
  expect(candidates).toEqual(
    NAMES.map((name) =>
      expect.objectContaining({
        candidateType: 'artist',
        name,
        provenanceProvider: provider,
        fallbackUsed: true,
      }),
    ),
  )
  for (const c of candidates as { mbid?: string }[]) expect(c.mbid).toBeUndefined()
}

describe.each(SPECS)('$id mode', (spec) => {
  it('enables with the provider path when connected and disables with a reason when not', () => {
    const on = evaluateDiscoveryModeAvailability(spec.id, {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      ...spec.snapshot,
    })
    expect(on).toMatchObject({ enabled: true, fallbackUsed: true, providerPath: [spec.provider] })

    const off = evaluateDiscoveryModeAvailability(spec.id, EMPTY_DISCOVERY_SNAPSHOT)
    expect(off.enabled).toBe(false)
    expect(off.reason).toMatch(spec.reason)
  })

  it('maps the feed to mbid-less artist candidates in order', async () => {
    const result = await spec.create().executor(makeRequest(spec.id, { limit: 10 }))
    expectArtistCandidates(result.candidates, spec.provider)
  })

  it.each([
    [999, 100],
    [0, 1],
    [undefined, 50],
  ])('limit %s reaches the client as %s', async (limit, expected) => {
    await spec.create().executor(makeRequest(spec.id, limit === undefined ? {} : { limit }))
    expect(spec.clientCall).toHaveBeenCalledWith(...spec.callArgs(expected))
  })

  it('throws the connect error when the provider is not connected', async () => {
    spec.breakConnection()
    await expect(spec.create().executor(makeRequest(spec.id))).rejects.toThrow(spec.connectError)
  })
})

describe('charts mode specifics', () => {
  it('maps empty-string mbids to undefined and keeps real ones', async () => {
    m.chartTopArtists.mockResolvedValue([
      { name: 'Artist A', mbid: 'mbid-a' },
      { name: 'Artist B', mbid: '' },
    ])
    const result = await createChartsMode().executor(makeRequest('charts', { region: 'global' }))
    expect(result.candidates.map((c) => (c as { mbid?: string }).mbid)).toEqual([
      'mbid-a',
      undefined,
    ])
  })

  it.each([
    [{ region: 'United Kingdom', limit: 20 }, [20, 'United Kingdom']],
    [{ region: 'global', limit: 50 }, [50, undefined]],
    [{}, [50, undefined]],
  ])('region setting %j calls the client with %j', async (settings, args) => {
    await createChartsMode().executor(makeRequest('charts', settings))
    expect(m.chartTopArtists).toHaveBeenCalledWith(...args)
  })
})

describe('subsonic-starred mode', () => {
  const id = 'subsonic-starred'
  const create = createSubsonicStarredMode

  it('enables with the provider path when connected and disables with a reason when not', () => {
    expect(
      evaluateDiscoveryModeAvailability(id, { ...EMPTY_DISCOVERY_SNAPSHOT, hasSubsonic: true }),
    ).toMatchObject({ enabled: true, fallbackUsed: true, providerPath: ['subsonic'] })
    const off = evaluateDiscoveryModeAvailability(id, EMPTY_DISCOVERY_SNAPSHOT)
    expect(off.enabled).toBe(false)
    expect(off.reason).toMatch(/subsonic/i)
  })

  it('maps starred artists to mbid-less candidates in order', async () => {
    const result = await create().executor(makeRequest(id, { limit: 10 }))
    expectArtistCandidates(result.candidates, 'subsonic')
  })

  it.each([true, false])('forwards skipTlsVerify=%s to the Subsonic client', async (value) => {
    m.getSkipTlsVerify.mockResolvedValue(value)
    await create().executor(makeRequest(id, { limit: 10 }))
    expect(m.createSubsonicClient).toHaveBeenCalledWith(
      'https://music.example.com',
      'alice',
      'secret',
      { skipTlsVerify: value },
    )
  })

  it.each([
    [10, 10],
    [undefined, 50],
  ])('limit %s keeps the first %s starred artists', async (limit, expected) => {
    m.starredArtists.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Artist ${i}` })),
    )
    const result = await create().executor(makeRequest(id, limit === undefined ? {} : { limit }))
    expect(result.candidates).toHaveLength(expected)
    expect((result.candidates[0] as { name: string }).name).toBe('Artist 0')
  })

  it.each([
    ['missing', null],
    ['incomplete', { subsonicUrl: 'https://music.example.com', subsonicUsername: null }],
  ])('throws the connect error when the connection is %s', async (_label, connection) => {
    m.getConnections.mockResolvedValue(connection)
    await expect(create().executor(makeRequest(id))).rejects.toThrow(
      'Connect Subsonic to use this mode.',
    )
  })
})

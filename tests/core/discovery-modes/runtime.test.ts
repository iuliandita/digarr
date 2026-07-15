// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

const {
  db,
  mockGetSettings,
  mockGetUserConnections,
  mockResolveDeezerToken,
  mockResolveSpotifyToken,
} = vi.hoisted(() => ({
  db: { kind: 'test-db' },
  mockGetSettings: vi.fn(),
  mockGetUserConnections: vi.fn(),
  mockResolveDeezerToken: vi.fn(),
  mockResolveSpotifyToken: vi.fn(),
}))

vi.mock('@/db', () => ({ db }))
vi.mock('@/db/queries/settings', () => ({ getSettings: mockGetSettings }))
vi.mock('@/db/queries/users', () => ({ getUserConnections: mockGetUserConnections }))
vi.mock('@/core/spotify-auth', () => ({ resolveSpotifyToken: mockResolveSpotifyToken }))
vi.mock('@/core/deezer-auth', () => ({ resolveDeezerToken: mockResolveDeezerToken }))

import {
  getDiscoveryModeConnections,
  getDiscoveryModeDeezerToken,
  getDiscoveryModeSkipTlsVerify,
  getDiscoveryModeSpotifyToken,
  getNormalizedLimit,
  getProviderPath,
  normalizeDiscoveryName,
  parseSeeds,
} from '@/core/discovery-modes/modes/runtime'

function request(
  normalizedSettings: Record<string, unknown>,
  providerPath: unknown = [],
): DiscoveryModeRequest {
  return {
    modeId: 'charts',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 7,
    rawUserSettings: normalizedSettings,
    normalizedSettings,
    providerContext: { providerPath },
    fallbackPolicy: 'allow-fallback',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('discovery mode runtime helpers', () => {
  it('normalizes finite limits and falls back for invalid values', () => {
    expect(getNormalizedLimit(request({}), 25)).toBe(25)
    expect(getNormalizedLimit(request({ limit: 12.9 }), 25)).toBe(12)
    expect(getNormalizedLimit(request({ limit: 0 }), 25)).toBe(1)
    expect(getNormalizedLimit(request({ limit: 500 }), 25, 100)).toBe(100)
    expect(getNormalizedLimit(request({ limit: 'not-a-number' }), 25)).toBe(25)
    expect(getNormalizedLimit(request({ limit: Number.POSITIVE_INFINITY }), 25)).toBe(25)
  })

  it('keeps only string entries from provider paths', () => {
    expect(getProviderPath(request({}, ['lastfm', 42, null, 'musicbrainz']))).toEqual([
      'lastfm',
      'musicbrainz',
    ])
    expect(getProviderPath(request({}, 'lastfm'))).toEqual([])
  })

  it('normalizes discovery names for comparison', () => {
    expect(normalizeDiscoveryName('  Boards Of Canada  ')).toBe('boards of canada')
  })

  it('parses string and object seed formats while dropping blank or malformed entries', () => {
    expect(parseSeeds(' Radiohead, , Portishead ')).toEqual([
      { name: 'Radiohead' },
      { name: 'Portishead' },
    ])
    expect(
      parseSeeds([
        '  Bjork ',
        { name: ' Massive Attack ', mbid: 'artist-mbid' },
        { name: 'Air', mbid: 42 },
        { name: ' ' },
        { title: 'wrong shape' },
        null,
      ]),
    ).toEqual([
      { name: 'Bjork' },
      { name: 'Massive Attack', mbid: 'artist-mbid' },
      { name: 'Air', mbid: undefined },
    ])
    expect(parseSeeds({ name: 'not-an-array' })).toEqual([])
  })

  it('delegates connection lookup with the requested user ID', async () => {
    const connections = { listenbrainzUsername: 'listener' }
    mockGetUserConnections.mockResolvedValue(connections)

    await expect(getDiscoveryModeConnections(7)).resolves.toBe(connections)
    expect(mockGetUserConnections).toHaveBeenCalledWith(db, 7)
  })

  it.each([
    [{ skipTlsVerify: true }, true],
    [{ skipTlsVerify: false }, false],
    [null, false],
  ] as const)('resolves the global TLS setting from %j as %s', async (settings, expected) => {
    mockGetSettings.mockResolvedValue(settings)

    await expect(getDiscoveryModeSkipTlsVerify()).resolves.toBe(expected)
    expect(mockGetSettings).toHaveBeenCalledWith(db)
  })

  it('returns resolved provider tokens', async () => {
    mockResolveSpotifyToken.mockResolvedValue('spotify-token')
    mockResolveDeezerToken.mockResolvedValue('deezer-token')

    await expect(getDiscoveryModeSpotifyToken(7)).resolves.toBe('spotify-token')
    await expect(getDiscoveryModeDeezerToken(7)).resolves.toBe('deezer-token')
    expect(mockResolveSpotifyToken).toHaveBeenCalledWith(db, 7)
    expect(mockResolveDeezerToken).toHaveBeenCalledWith(db, 7)
  })

  it('returns null when provider token resolution fails', async () => {
    mockResolveSpotifyToken.mockRejectedValue(new Error('missing Spotify token'))
    mockResolveDeezerToken.mockRejectedValue(new Error('missing Deezer token'))

    await expect(getDiscoveryModeSpotifyToken(7)).resolves.toBeNull()
    await expect(getDiscoveryModeDeezerToken(7)).resolves.toBeNull()
  })
})

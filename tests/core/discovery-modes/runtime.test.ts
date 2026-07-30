// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

const { db, mockGetSettings, mockGetUserConnections, mockResolveProviderToken } = vi.hoisted(
  () => ({
    db: { kind: 'test-db' },
    mockGetSettings: vi.fn(),
    mockGetUserConnections: vi.fn(),
    mockResolveProviderToken: vi.fn(),
  }),
)

class FakeProviderAuthError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: string,
    message: string,
  ) {
    super(message)
  }
}

vi.mock('@/db', () => ({ db }))
vi.mock('@/db/queries/settings', () => ({ getSettings: mockGetSettings }))
vi.mock('@/db/queries/users', () => ({ getUserConnections: mockGetUserConnections }))
vi.mock('@/core/provider-auth', () => ({
  resolveProviderToken: mockResolveProviderToken,
  ProviderAuthError: FakeProviderAuthError,
  providerLabel: (provider: string) =>
    ({ spotify: 'Spotify', deezer: 'Deezer', tidal: 'TIDAL' })[provider],
}))

import {
  getDiscoveryModeConnections,
  getDiscoveryModeProviderToken,
  getDiscoveryModeSkipTlsVerify,
  getNormalizedLimit,
  getProviderPath,
  normalizeDiscoveryName,
  parseSeeds,
  requireDiscoveryModeProviderToken,
  resolveDiscoveryModeProviderToken,
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
    mockResolveProviderToken.mockResolvedValue('spotify-token')

    await expect(getDiscoveryModeProviderToken(7, 'spotify')).resolves.toBe('spotify-token')
    expect(mockResolveProviderToken).toHaveBeenCalledWith(db, 7, 'spotify')
  })

  it('returns null when provider token resolution fails', async () => {
    mockResolveProviderToken.mockRejectedValue(new Error('missing Deezer token'))

    await expect(getDiscoveryModeProviderToken(7, 'deezer')).resolves.toBeNull()
  })

  it('reports a never-connected provider as such, without logging', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolveProviderToken.mockRejectedValue(
      new FakeProviderAuthError('tidal', 'not_connected', 'No TIDAL OAuth token'),
    )

    await expect(resolveDiscoveryModeProviderToken(7, 'tidal')).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
      message: 'Connect TIDAL to use this mode.',
    })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('distinguishes an unusable token from a missing connection, and logs the cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolveProviderToken.mockRejectedValue(
      new FakeProviderAuthError('spotify', 'token_unusable', 'expired and could not be refreshed'),
    )

    const result = await resolveDiscoveryModeProviderToken(7, 'spotify')
    expect(result).toEqual({
      ok: false,
      reason: 'token_unusable',
      message: 'Your Spotify connection is no longer usable - reconnect Spotify in Settings.',
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('surfaces an unexpected failure as an unusable token rather than a missing connection', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolveProviderToken.mockRejectedValue(new Error('DIGARR_ENCRYPTION_KEY mismatch'))

    const result = await resolveDiscoveryModeProviderToken(7, 'deezer')
    expect(result).toMatchObject({ ok: false, reason: 'token_unusable' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('throws the resolved message when a token is required', async () => {
    mockResolveProviderToken.mockRejectedValue(
      new FakeProviderAuthError('spotify', 'not_connected', 'No Spotify OAuth token'),
    )

    await expect(requireDiscoveryModeProviderToken(7, 'spotify')).rejects.toThrow(
      'Connect Spotify to use this mode.',
    )
  })
})

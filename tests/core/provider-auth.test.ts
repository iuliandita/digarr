// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
}))
vi.mock('@/core/oauth', () => ({ getValidToken: vi.fn() }))

const { getOAuthToken } = await import('@/db/queries/oauth-tokens')
const { getValidToken } = await import('@/core/oauth')
const { ProviderAuthError, providerLabel, resolveProviderToken } = await import(
  '@/core/provider-auth'
)

const mockDb = {} as never

function row(overrides: Partial<Awaited<ReturnType<typeof getOAuthToken>>> = {}) {
  return {
    id: 1,
    userId: 1,
    provider: 'deezer',
    accessToken: 'valid-token',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    scopes: 'basic_access',
    clientId: null,
    clientSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('providerLabel', () => {
  it.each([
    ['spotify', 'Spotify'],
    ['deezer', 'Deezer'],
    ['tidal', 'TIDAL'],
  ] as const)('names %s as %s', (provider, label) => {
    expect(providerLabel(provider)).toBe(label)
  })
})

describe('resolveProviderToken', () => {
  it.each(['spotify', 'deezer', 'tidal'] as const)(
    'throws not_connected for %s when no token is stored',
    async (provider) => {
      vi.mocked(getOAuthToken).mockResolvedValueOnce(null)

      const err = await resolveProviderToken(mockDb, 1, provider).catch((e) => e)
      expect(err).toBeInstanceOf(ProviderAuthError)
      expect(err.reason).toBe('not_connected')
      expect(err.provider).toBe(provider)
      expect(err.message).toContain(providerLabel(provider))
    },
  )

  it.each(['spotify', 'deezer', 'tidal'] as const)(
    'throws not_connected for %s when the token is a legacy pending marker',
    async (provider) => {
      vi.mocked(getOAuthToken).mockResolvedValueOnce(row({ accessToken: 'pending:1:abc' }))

      await expect(resolveProviderToken(mockDb, 1, provider)).rejects.toThrow('No')
      expect(getValidToken).not.toHaveBeenCalled()
    },
  )

  it('returns a Deezer token without attempting a refresh, even when expired', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(
      row({ accessToken: 'old-token', expiresAt: new Date(Date.now() - 86_400_000) }),
    )

    await expect(resolveProviderToken(mockDb, 1, 'deezer')).resolves.toBe('old-token')
    expect(getValidToken).not.toHaveBeenCalled()
  })

  it('returns the stored token when the provider refreshes but has no credentials', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(row({ provider: 'spotify' }))

    await expect(resolveProviderToken(mockDb, 1, 'spotify')).resolves.toBe('valid-token')
    expect(getValidToken).not.toHaveBeenCalled()
  })

  it('refreshes Spotify with body-style client authentication', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(
      row({ provider: 'spotify', clientId: 'cid', clientSecret: 'secret' }),
    )
    vi.mocked(getValidToken).mockResolvedValueOnce('refreshed')

    await expect(resolveProviderToken(mockDb, 1, 'spotify')).resolves.toBe('refreshed')
    expect(getValidToken).toHaveBeenCalledWith(mockDb, 1, 'spotify', {
      tokenEndpoint: 'https://accounts.spotify.com/api/token',
      clientId: 'cid',
      clientSecret: 'secret',
      authStyle: 'body',
    })
  })

  it('refreshes TIDAL with Basic client authentication, matching its code exchange', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(
      row({ provider: 'tidal', clientId: 'cid', clientSecret: 'secret' }),
    )
    vi.mocked(getValidToken).mockResolvedValueOnce('refreshed')

    await expect(resolveProviderToken(mockDb, 1, 'tidal')).resolves.toBe('refreshed')
    expect(getValidToken).toHaveBeenCalledWith(
      mockDb,
      1,
      'tidal',
      expect.objectContaining({
        tokenEndpoint: 'https://auth.tidal.com/v1/oauth2/token',
        authStyle: 'basic',
      }),
    )
  })

  it('throws token_unusable when the refresh fails', async () => {
    vi.mocked(getOAuthToken).mockResolvedValueOnce(
      row({ provider: 'tidal', clientId: 'cid', clientSecret: 'secret' }),
    )
    vi.mocked(getValidToken).mockResolvedValueOnce(null)

    const err = await resolveProviderToken(mockDb, 1, 'tidal').catch((e) => e)
    expect(err).toBeInstanceOf(ProviderAuthError)
    expect(err.reason).toBe('token_unusable')
    expect(err.message).toContain('could not be refreshed')
  })
})

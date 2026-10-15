import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPlaylistResolverDeps } from '@/core/playlists/resolver-deps'
import type { Database } from '@/db'

const mocks = vi.hoisted(() => {
  const localTracks = [{ name: 'Creep', artist: 'Radiohead', path: '/music/creep.flac' }]
  const localClient = () => ({ searchTracks: vi.fn().mockResolvedValue(localTracks) })
  return {
    connections: vi.fn(),
    settings: vi.fn(),
    oauth: vi.fn(),
    token: vi.fn(),
    jellyfin: vi.fn(localClient),
    emby: vi.fn(localClient),
    subsonic: vi.fn(localClient),
    plex: vi.fn(localClient),
    recordings: vi.fn().mockResolvedValue([{ id: 'recording', title: 'Creep' }]),
    deezer: vi.fn().mockResolvedValue([]),
    spotifySearch: vi.fn().mockResolvedValue([]),
    spotify: vi.fn(),
    localTracks,
  }
})

vi.mock('@/db/queries/settings', () => ({ getSettings: mocks.settings }))
vi.mock('@/db/queries/users', () => ({ getUserConnections: mocks.connections }))
vi.mock('@/db/queries/oauth-tokens', () => ({ getOAuthToken: mocks.oauth }))
vi.mock('@/core/provider-auth', () => ({ resolveProviderToken: mocks.token }))
vi.mock('@/core/clients/jellyfin', () => ({ createJellyfinClient: mocks.jellyfin }))
vi.mock('@/core/clients/emby', () => ({ createEmbyClient: mocks.emby }))
vi.mock('@/core/clients/subsonic', () => ({ createSubsonicClient: mocks.subsonic }))
vi.mock('@/core/clients/plex', () => ({ createPlexClient: mocks.plex }))
vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: () => ({ getRecordings: mocks.recordings }),
}))
vi.mock('@/core/clients/deezer', () => ({
  createDeezerClient: () => ({ searchTracks: mocks.deezer }),
}))
vi.mock('@/core/clients/spotify', () => ({ createSpotifyClient: mocks.spotify }))

const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connections.mockReset().mockResolvedValue(null)
  mocks.settings.mockReset().mockResolvedValue(null)
  mocks.oauth.mockReset().mockResolvedValue(null)
  mocks.token.mockReset().mockResolvedValue('refreshed-token')
  mocks.spotify.mockReset().mockReturnValue({ searchTracks: mocks.spotifySearch })
})

describe('production playlist resolver dependencies', () => {
  it('keeps public catalog fallbacks without borrowing a user connection for ownerless playlists', async () => {
    const deps = await buildPlaylistResolverDeps(db, null)
    expect(mocks.connections).not.toHaveBeenCalled()
    expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.oauth).not.toHaveBeenCalled()
    expect(Object.keys(deps).sort()).toEqual(['deezerSearch', 'musicbrainzRecordings'])
    await expect(deps.musicbrainzRecordings?.('artist-mbid')).resolves.toEqual([
      { id: 'recording', title: 'Creep' },
    ])
    await deps.deezerSearch?.('artist:Radiohead', 3)
    expect(mocks.recordings).toHaveBeenCalledWith('artist-mbid')
    expect(mocks.deezer).toHaveBeenCalledWith('artist:Radiohead', 3)
  })

  it.each([null, false, true])(
    'constructs owner-scoped clients with saved users, library filters and TLS setting %s',
    async (savedTls) => {
      mocks.settings.mockResolvedValue(savedTls === null ? null : { skipTlsVerify: savedTls })
      const skipTlsVerify = savedTls ?? false
      mocks.connections.mockImplementation(async (_db: Database, userId: number) => ({
        jellyfinUrl: `http://jellyfin-${userId}.example.test`,
        jellyfinApiKey: `jellyfin-key-${userId}`,
        jellyfinUserId: `jellyfin-user-${userId}`,
        jellyfinLibraryId: `jellyfin-library-${userId}`,
        embyUrl: `http://emby-${userId}.example.test`,
        embyApiKey: `emby-key-${userId}`,
        embyUserId: `emby-user-${userId}`,
        embyLibraryId: `emby-library-${userId}`,
        subsonicUrl: `http://subsonic-${userId}.example.test`,
        subsonicUsername: `subsonic-user-${userId}`,
        subsonicPassword: `subsonic-password-${userId}`,
        plexUrl: `http://plex-${userId}.example.test`,
        plexToken: `plex-token-${userId}`,
        plexSectionId: `plex-section-${userId}`,
      }))
      for (const userId of [7, 42]) {
        const deps = await buildPlaylistResolverDeps(db, userId)
        expect(mocks.connections).toHaveBeenLastCalledWith(db, userId)
        expect(mocks.jellyfin).toHaveBeenLastCalledWith(
          `http://jellyfin-${userId}.example.test`,
          `jellyfin-key-${userId}`,
          `jellyfin-user-${userId}`,
          { libraryId: `jellyfin-library-${userId}`, skipTlsVerify },
        )
        expect(mocks.emby).toHaveBeenLastCalledWith(
          `http://emby-${userId}.example.test`,
          `emby-key-${userId}`,
          `emby-user-${userId}`,
          { libraryId: `emby-library-${userId}`, skipTlsVerify },
        )
        expect(mocks.subsonic).toHaveBeenLastCalledWith(
          `http://subsonic-${userId}.example.test`,
          `subsonic-user-${userId}`,
          `subsonic-password-${userId}`,
          { skipTlsVerify },
        )
        expect(mocks.plex).toHaveBeenLastCalledWith(
          `http://plex-${userId}.example.test`,
          `plex-token-${userId}`,
          { sectionId: `plex-section-${userId}` },
        )
        for (const search of [
          deps.jellyfinSearch,
          deps.embySearch,
          deps.navidromeSearch,
          deps.plexSearch,
        ]) {
          await expect(search?.('Radiohead')).resolves.toEqual(mocks.localTracks)
        }
      }
    },
  )

  it('omits incomplete local connections and resolves a fresh owner token for every Spotify search', async () => {
    mocks.connections.mockResolvedValue({
      jellyfinUrl: 'http://jellyfin.example.test',
      jellyfinApiKey: 'key',
      embyUrl: 'http://emby.example.test',
      embyUserId: 'user',
      subsonicUrl: 'http://subsonic.example.test',
      subsonicUsername: 'user',
      plexUrl: 'http://plex.example.test',
    })
    mocks.oauth.mockResolvedValue({ provider: 'spotify' })
    mocks.token.mockResolvedValueOnce('first-token').mockResolvedValueOnce('second-token')
    const deps = await buildPlaylistResolverDeps(db, 42)
    expect(Object.keys(deps).sort()).toEqual([
      'deezerSearch',
      'musicbrainzRecordings',
      'spotifySearch',
    ])
    for (const factory of [mocks.jellyfin, mocks.emby, mocks.subsonic, mocks.plex]) {
      expect(factory).not.toHaveBeenCalled()
    }
    expect(mocks.oauth).toHaveBeenCalledWith(db, 42, 'spotify')
    await deps.spotifySearch?.('artist:Radiohead', 3)
    await deps.spotifySearch?.('artist:Björk', 2)
    expect(mocks.token.mock.calls).toEqual([
      [db, 42, 'spotify'],
      [db, 42, 'spotify'],
    ])
    expect(mocks.spotify.mock.calls).toEqual([['first-token'], ['second-token']])
    expect(mocks.spotifySearch.mock.calls).toEqual([
      ['artist:Radiohead', 3],
      ['artist:Björk', 2],
    ])
  })
})

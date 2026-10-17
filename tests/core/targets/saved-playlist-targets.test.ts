// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSavedPlaylistExportTarget } from '@/core/targets/saved-playlist-targets'

const options = { globalSkipTlsVerify: false, getSpotifyAccessToken: async () => 'token' }
const config = {
  url: 'http://media:8096',
  apiKey: 'key',
  userId: 'user-1',
  username: 'admin',
  password: 'secret',
  token: 'plex-token',
}

describe('createSavedPlaylistExportTarget', () => {
  it.each([
    'navidrome-playlist',
    'jellyfin-playlist',
    'emby-playlist',
    'plex-playlist',
    'spotify-playlist',
  ])('builds a %s destination that can open an export session', (type) => {
    const target = createSavedPlaylistExportTarget({ id: 7, type, config }, options)
    expect(target?.type).toBe(type)
    expect(target?.openPlaylistExportSession).toBeTypeOf('function')
  })

  it.each(['lidarr', 'slskd', 'unknown'])('returns null for %s', (type) => {
    expect(createSavedPlaylistExportTarget({ id: 7, type, config }, options)).toBeNull()
  })
})

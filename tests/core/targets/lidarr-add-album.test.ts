// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

const { createLidarrClient } = await import('@/core/clients/lidarr')
const { createLidarrTarget } = await import('@/core/targets/lidarr')

function mockLidarrClient() {
  const client = {
    getArtists: vi.fn().mockResolvedValue([]),
    findArtistByMbid: vi.fn().mockResolvedValue(null),
    addArtist: vi.fn().mockResolvedValue({ id: 42, artistName: 'Artist' }),
    getAlbums: vi.fn().mockResolvedValue([]),
    setAlbumsMonitored: vi.fn().mockResolvedValue([]),
    triggerCommand: vi.fn().mockResolvedValue({}),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music' }]),
  }
  vi.mocked(createLidarrClient).mockReturnValue(client as never)
  return client
}

describe('createLidarrTarget().addAlbum', () => {
  it('capabilities includes addAlbum', () => {
    mockLidarrClient()
    const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })
    expect(target.capabilities).toContain('addAlbum')
  })

  it('adds absent artist unmonitored, monitors only the target album and searches it', async () => {
    const client = mockLidarrClient()
    client.findArtistByMbid.mockResolvedValue(null)
    client.addArtist.mockResolvedValue({ id: 42 })
    client.getAlbums.mockResolvedValue([
      { id: 7, foreignAlbumId: 'rg-1', monitored: false, title: 'One' },
    ])

    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    )

    expect(result?.success).toBe(true)
    expect(result?.targetType).toBe('lidarr')
    expect(result?.targetId).toBe(1)
    expect(result?.externalId).toBe(7)

    expect(client.addArtist).toHaveBeenCalledWith('a1', 'Artist', 1, 1, 1, {
      monitorOption: 'none',
    })
    expect(client.getAlbums).toHaveBeenCalledWith(42)
    expect(client.setAlbumsMonitored).toHaveBeenCalledWith([7], true)
    expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [7] })
  })

  it('reuses already-tracked artist without re-adding (gap-fill safe)', async () => {
    const client = mockLidarrClient()
    client.findArtistByMbid.mockResolvedValue({ id: 99, foreignArtistId: 'a1' })
    client.getAlbums.mockResolvedValue([
      { id: 7, foreignAlbumId: 'rg-1', monitored: false, title: 'One' },
    ])

    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    )

    expect(result?.success).toBe(true)
    expect(client.addArtist).not.toHaveBeenCalled()
    expect(client.getAlbums).toHaveBeenCalledWith(99)
    expect(client.setAlbumsMonitored).toHaveBeenCalledWith([7], true)
    expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [7] })
  })

  it('returns failure when the album is not found in Lidarr', async () => {
    const client = mockLidarrClient()
    client.findArtistByMbid.mockResolvedValue({ id: 99, foreignArtistId: 'a1' })
    client.getAlbums.mockResolvedValue([])

    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    )

    expect(result?.success).toBe(false)
    expect(result?.error).toBeTruthy()
    expect(client.setAlbumsMonitored).not.toHaveBeenCalled()
    expect(client.triggerCommand).not.toHaveBeenCalled()
  })

  it('returns success:false with "album not found in Lidarr" when the release group is absent after add', async () => {
    vi.useFakeTimers()
    try {
      const client = mockLidarrClient()
      client.findArtistByMbid.mockResolvedValue(null)
      client.addArtist.mockResolvedValue({ id: 42 })
      // Lidarr has the artist but never surfaces this release group
      client.getAlbums.mockResolvedValue([
        { id: 7, foreignAlbumId: 'some-other-rg', monitored: false, title: 'Other' },
      ])

      const target = createLidarrTarget(1, {
        url: 'http://lidarr:8686',
        apiKey: 'abc',
      })

      const pending = target.addAlbum?.(
        { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-missing' },
        { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result?.success).toBe(false)
      expect(result?.error).toBe('album not found in Lidarr')
      expect(client.setAlbumsMonitored).not.toHaveBeenCalled()
      expect(client.triggerCommand).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Regression: Lidarr populates a just-added artist's album list
  // asynchronously; addAlbum must poll like addArtist does instead of failing
  // on the first empty getAlbums response.
  it('polls until the album appears after adding a new artist', async () => {
    vi.useFakeTimers()
    try {
      const client = mockLidarrClient()
      client.findArtistByMbid.mockResolvedValue(null)
      client.addArtist.mockResolvedValue({ id: 42 })
      client.getAlbums
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 7, foreignAlbumId: 'rg-1', monitored: false, title: 'One' }])

      const target = createLidarrTarget(1, {
        url: 'http://lidarr:8686',
        apiKey: 'abc',
      })

      const pending = target.addAlbum?.(
        { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
        { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result?.success).toBe(true)
      expect(result?.externalId).toBe(7)
      expect(client.getAlbums).toHaveBeenCalledTimes(2)
      expect(client.setAlbumsMonitored).toHaveBeenCalledWith([7], true)
      expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [7] })
    } finally {
      vi.useRealTimers()
    }
  })

  // Issue #589: this path used to fetch the entire artist list to find one
  // MBID, which times out on large libraries and blocks approved adds.
  it('looks the artist up by MBID instead of fetching the whole library', async () => {
    const client = mockLidarrClient()
    client.findArtistByMbid.mockResolvedValue({ id: 99, foreignArtistId: 'a1' })
    client.getAlbums.mockResolvedValue([
      { id: 7, foreignAlbumId: 'rg-1', monitored: false, title: 'One' },
    ])

    const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })
    await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    )

    expect(client.findArtistByMbid).toHaveBeenCalledWith('a1')
    expect(client.getArtists).not.toHaveBeenCalled()
  })

  it('does not poll for an already-tracked artist with the album absent', async () => {
    const client = mockLidarrClient()
    client.findArtistByMbid.mockResolvedValue({ id: 99, foreignArtistId: 'a1' })
    client.getAlbums.mockResolvedValue([])

    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      { qualityProfileId: 1, metadataProfileId: 1, rootFolderId: 1 },
    )

    expect(result?.success).toBe(false)
    expect(client.getAlbums).toHaveBeenCalledTimes(1)
  })
})

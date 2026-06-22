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
    addArtist: vi.fn().mockResolvedValue({ id: 42, artistName: 'Artist' }),
    getAlbums: vi.fn().mockResolvedValue([]),
    updateAlbum: vi.fn().mockResolvedValue({}),
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
    client.getArtists.mockResolvedValue([])
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
    expect(client.updateAlbum).toHaveBeenCalledWith(7, { monitored: true })
    expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [7] })
  })

  it('reuses already-tracked artist without re-adding (gap-fill safe)', async () => {
    const client = mockLidarrClient()
    client.getArtists.mockResolvedValue([{ id: 99, foreignArtistId: 'a1' }])
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
    expect(client.updateAlbum).toHaveBeenCalledWith(7, { monitored: true })
    expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [7] })
  })

  it('returns failure when the album is not found in Lidarr', async () => {
    const client = mockLidarrClient()
    client.getArtists.mockResolvedValue([{ id: 99, foreignArtistId: 'a1' }])
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
    expect(client.updateAlbum).not.toHaveBeenCalled()
    expect(client.triggerCommand).not.toHaveBeenCalled()
  })
})

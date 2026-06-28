// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

const { createLidarrClient } = await import('@/core/clients/lidarr')
const { createLidarrTarget } = await import('@/core/targets/lidarr')

function mockLidarrClient() {
  const client = {
    addArtist: vi.fn().mockResolvedValue({ id: 42, artistName: 'Radiohead' }),
    getAlbums: vi.fn().mockResolvedValue([]),
    updateAlbum: vi.fn().mockResolvedValue({}),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music' }]),
  }
  vi.mocked(createLidarrClient).mockReturnValue(client as never)
  return client
}

describe('createLidarrTarget()', () => {
  it('has correct id, type, and capabilities', () => {
    mockLidarrClient()
    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })
    expect(target.type).toBe('lidarr')
    expect(target.capabilities).toContain('addArtist')
    expect(target.id).toBe('lidarr-1')
  })

  it('addArtist calls lidarr.addArtist with correct params', async () => {
    const client = mockLidarrClient()
    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
      qualityProfileId: 2,
      metadataProfileId: 3,
      rootFolderId: 4,
    })

    const result = await target.addArtist?.(
      { mbid: 'mbid-rh', name: 'Radiohead' },
      { monitorOption: 'all' },
    )

    expect(result?.success).toBe(true)
    expect(result?.externalId).toBe(42)
    expect(result?.targetType).toBe('lidarr')
    expect(result?.targetId).toBe(1)
    expect(client.addArtist).toHaveBeenCalledWith('mbid-rh', 'Radiohead', 2, 3, 4, {
      monitorOption: 'all',
    })
  })

  it('addArtist returns failure on Lidarr error', async () => {
    const client = mockLidarrClient()
    client.addArtist.mockRejectedValue(new Error('Artist already exists'))
    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    const result = await target.addArtist?.({ mbid: 'mbid-rh', name: 'Radiohead' })
    expect(result?.success).toBe(false)
    expect(result?.error).toBe('Artist already exists')
  })

  it('addArtist with selected albums monitors individual albums', async () => {
    const client = mockLidarrClient()
    client.getAlbums.mockResolvedValue([
      { id: 10, foreignAlbumId: 'album-1', monitored: false },
      { id: 11, foreignAlbumId: 'album-2', monitored: false },
    ])
    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })

    await target.addArtist?.(
      { mbid: 'mbid-rh', name: 'Radiohead' },
      { monitorOption: 'selected', selectedAlbumIds: ['album-1'] },
    )

    expect(client.addArtist).toHaveBeenCalledWith('mbid-rh', 'Radiohead', 1, 1, undefined, {
      monitorOption: 'none',
    })
    expect(client.updateAlbum).toHaveBeenCalledWith(10, { monitored: true })
    expect(client.updateAlbum).not.toHaveBeenCalledWith(11, expect.anything())
  })

  it('testConnection delegates to lidarr client', async () => {
    mockLidarrClient()
    const target = createLidarrTarget(1, {
      url: 'http://lidarr:8686',
      apiKey: 'abc',
    })
    const result = await target.testConnection()
    expect(result.success).toBe(true)
  })
})

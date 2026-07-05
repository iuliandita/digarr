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
    setAlbumsMonitored: vi.fn().mockResolvedValue([]),
    triggerCommand: vi.fn().mockResolvedValue({}),
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

    const result = await target.addArtist?.(
      { mbid: 'mbid-rh', name: 'Radiohead' },
      { monitorOption: 'selected', selectedAlbumIds: ['album-1'] },
    )

    expect(result?.success).toBe(true)
    expect(client.addArtist).toHaveBeenCalledWith('mbid-rh', 'Radiohead', 1, 1, undefined, {
      monitorOption: 'none',
    })
    expect(client.setAlbumsMonitored).toHaveBeenCalledWith([10], true)
    // The monitored album must also be searched, otherwise it is never grabbed.
    expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [10] })
  })

  it('addArtist retries getAlbums until Lidarr populates the selected album', async () => {
    vi.useFakeTimers()
    try {
      const client = mockLidarrClient()
      // Lidarr returns an empty album list on the first poll (async population),
      // then surfaces the album on the retry.
      client.getAlbums
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 10, foreignAlbumId: 'album-1', monitored: false }])
      const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })

      const pending = target.addArtist?.(
        { mbid: 'mbid-rh', name: 'Radiohead' },
        { monitorOption: 'selected', selectedAlbumIds: ['album-1'] },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result?.success).toBe(true)
      expect(client.getAlbums).toHaveBeenCalledTimes(2)
      expect(client.setAlbumsMonitored).toHaveBeenCalledWith([10], true)
      expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [10] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('addArtist succeeds with a warning (no orphan) when the selected album never appears', async () => {
    vi.useFakeTimers()
    try {
      const client = mockLidarrClient() // getAlbums always returns []
      const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })

      const pending = target.addArtist?.(
        { mbid: 'mbid-rh', name: 'Radiohead' },
        { monitorOption: 'selected', selectedAlbumIds: ['ghost-album'] },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      // The artist WAS added; only the secondary monitoring step came up empty.
      // Surfacing success:true keeps the Lidarr artist id persisted so a retry
      // reconciles instead of orphaning + re-adding (duplicate).
      expect(result?.success).toBe(true)
      expect(result?.externalId).toBe(42)
      expect(result?.error).toBeUndefined()
      expect(result?.warning).toMatch(/not found in Lidarr/)
      expect(client.setAlbumsMonitored).not.toHaveBeenCalled()
      expect(client.triggerCommand).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('addArtist succeeds with a warning when monitoring the selected album throws', async () => {
    const client = mockLidarrClient()
    client.getAlbums.mockResolvedValue([{ id: 10, foreignAlbumId: 'album-1', monitored: false }])
    client.setAlbumsMonitored.mockRejectedValue(new Error('Lidarr 500'))
    const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })

    const result = await target.addArtist?.(
      { mbid: 'mbid-rh', name: 'Radiohead' },
      { monitorOption: 'selected', selectedAlbumIds: ['album-1'] },
    )

    // Monitoring is best-effort and must never fail the add.
    expect(result?.success).toBe(true)
    expect(result?.externalId).toBe(42)
    expect(result?.warning).toMatch(/Lidarr 500/)
  })

  it('addArtist monitors found albums and warns about the ones not in Lidarr (partial)', async () => {
    vi.useFakeTimers()
    try {
      const client = mockLidarrClient()
      // album-2 never appears, so the poll runs out of attempts with a partial match.
      client.getAlbums.mockResolvedValue([{ id: 10, foreignAlbumId: 'album-1', monitored: false }])
      const target = createLidarrTarget(1, { url: 'http://lidarr:8686', apiKey: 'abc' })

      const pending = target.addArtist?.(
        { mbid: 'mbid-rh', name: 'Radiohead' },
        { monitorOption: 'selected', selectedAlbumIds: ['album-1', 'album-2'] },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result?.success).toBe(true)
      expect(result?.externalId).toBe(42)
      expect(client.setAlbumsMonitored).toHaveBeenCalledWith([10], true)
      expect(client.triggerCommand).toHaveBeenCalledWith('AlbumSearch', { albumIds: [10] })
      // Not silently success: the user must learn album-2 was not monitored.
      expect(result?.warning).toMatch(/1 of 2/)
    } finally {
      vi.useRealTimers()
    }
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

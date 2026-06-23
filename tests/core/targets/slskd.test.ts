// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSlskdTarget, type SlskdTargetConfig } from '@/core/targets/slskd'

function makeConfig(overrides?: { queueAlbum?: SlskdTargetConfig['queueAlbum'] }) {
  const queueAlbum: SlskdTargetConfig['queueAlbum'] =
    overrides?.queueAlbum ?? vi.fn(async () => ({ success: true }))
  const config: SlskdTargetConfig = {
    name: 'slskd',
    testConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
    queueArtist: vi.fn(async () => ({ success: true })),
    queueAlbum,
  }
  return { queueAlbum, config }
}

describe('createSlskdTarget().addAlbum', () => {
  it('returns failure without calling queueAlbum when userId is missing', async () => {
    const { config, queueAlbum } = makeConfig()
    const target = createSlskdTarget(4, config)

    const result = await target.addAlbum?.({
      artistMbid: 'a1',
      artistName: 'Burial',
      releaseGroupMbid: 'rg-1',
    })

    expect(result).toEqual({
      success: false,
      targetType: 'slskd',
      targetId: 4,
      error: 'slskd target requires user context',
    })
    expect(queueAlbum).not.toHaveBeenCalled()
  })

  it('queues the album as a standalone approval when there is no linked Lidarr artist', async () => {
    const { config, queueAlbum } = makeConfig()
    const target = createSlskdTarget(4, config)

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Burial', releaseGroupMbid: 'rg-1' },
      { userId: 1 },
    )

    expect(result).toEqual({ success: true, targetType: 'slskd', targetId: 4 })
    expect(queueAlbum).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'standalone_approval',
        userId: 1,
        targetId: 4,
        artist: { mbid: 'a1', name: 'Burial' },
        releaseGroupMbid: 'rg-1',
      }),
    )
  })

  it('queues a combined approval when a linked Lidarr artist id is present', async () => {
    const { config, queueAlbum } = makeConfig()
    const target = createSlskdTarget(4, config)

    await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Burial', releaseGroupMbid: 'rg-1' },
      { userId: 1, lidarrArtistId: 99 },
    )

    expect(queueAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'combined_approval', lidarrArtistId: 99 }),
    )
  })

  it('returns the "no releases queued" failure when queueAlbum reports no success', async () => {
    const queueAlbum: SlskdTargetConfig['queueAlbum'] = vi.fn(async () => ({ success: false }))
    const { config } = makeConfig({ queueAlbum })
    const target = createSlskdTarget(4, config)

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Burial', releaseGroupMbid: 'rg-1' },
      { userId: 1 },
    )

    expect(result).toEqual({
      success: false,
      targetType: 'slskd',
      targetId: 4,
      error: 'No releases were queued for slskd',
    })
  })

  it('catches a rejected queueAlbum and reports the error message', async () => {
    const queueAlbum: SlskdTargetConfig['queueAlbum'] = vi.fn(async () => {
      throw new Error('boom')
    })
    const { config } = makeConfig({ queueAlbum })
    const target = createSlskdTarget(4, config)

    const result = await target.addAlbum?.(
      { artistMbid: 'a1', artistName: 'Burial', releaseGroupMbid: 'rg-1' },
      { userId: 1 },
    )

    expect(result).toEqual({
      success: false,
      targetType: 'slskd',
      targetId: 4,
      error: 'boom',
    })
  })

  it('advertises both addArtist and addAlbum capabilities', () => {
    const { config } = makeConfig()
    const target = createSlskdTarget(4, config)

    expect(target.capabilities).toContain('addArtist')
    expect(target.capabilities).toContain('addAlbum')
  })
})

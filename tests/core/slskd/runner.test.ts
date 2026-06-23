// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSlskdRunner } from '@/core/slskd/runner'

describe('createSlskdRunner', () => {
  it('creates pending slskd jobs for standalone approval releases without duplicates', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const findActiveJob = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 5 })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob,
      resolveReleaseGroups: vi.fn().mockResolvedValue([
        { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' },
        { releaseGroupMbid: 'rg-2', releaseTitle: 'Rival Dealer' },
      ]),
    })

    const result = await runner.queueArtist({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
    })

    expect(result.success).toBe(true)
    expect(createJob).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        targetId: 4,
        sourceType: 'standalone_approval',
        artistName: 'Burial',
        releaseGroupMbid: 'rg-1',
        releaseTitle: 'Untrue',
      }),
    )
  })

  it('uses a target-scoped work key so different slskd targets do not dedupe each other', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([{ releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' }]),
    })

    await runner.queueArtist({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
    })
    await runner.queueArtist({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 5,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
    })

    expect(createJob).toHaveBeenCalledTimes(2)
    expect(createJob.mock.calls[0]?.[0].workKey).not.toBe(createJob.mock.calls[1]?.[0].workKey)
  })
})

describe('createSlskdRunner().queueAlbum', () => {
  it('queues exactly the matched release group', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi.fn().mockResolvedValue([
        { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' },
        { releaseGroupMbid: 'rg-2', releaseTitle: 'Rival Dealer' },
      ]),
    })

    const result = await runner.queueAlbum({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-2',
    })

    expect(result.success).toBe(true)
    expect(createJob).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseGroupMbid: 'rg-2',
        releaseTitle: 'Rival Dealer',
      }),
    )
  })

  it('returns failure and skips createJob when the release group is unknown', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([{ releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' }]),
    })

    const result = await runner.queueAlbum({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-missing',
    })

    expect(result.success).toBe(false)
    expect(createJob).not.toHaveBeenCalled()
  })

  it('treats an already-active job as success without creating a duplicate', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue({ id: 7 }),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([{ releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' }]),
    })

    const result = await runner.queueAlbum({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-1',
    })

    expect(result.success).toBe(true)
    expect(createJob).not.toHaveBeenCalled()
  })

  it('maps the source type from the presence of a linked Lidarr artist', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const makeRunner = () =>
      createSlskdRunner({
        createJob,
        findActiveJob: vi.fn().mockResolvedValue(null),
        resolveReleaseGroups: vi
          .fn()
          .mockResolvedValue([{ releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue' }]),
      })

    await makeRunner().queueAlbum({
      sourceType: 'combined_approval',
      userId: 1,
      targetId: 4,
      lidarrArtistId: 99,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-1',
    })
    await makeRunner().queueAlbum({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-1',
    })

    expect(createJob.mock.calls[0]?.[0].sourceType).toBe('combined_approval')
    expect(createJob.mock.calls[1]?.[0].sourceType).toBe('standalone_approval')
  })
})

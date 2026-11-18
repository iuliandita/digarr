// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSlskdRunner } from '@/core/slskd/runner'

describe('createSlskdRunner', () => {
  it.each(['standalone_approval', 'combined_approval'] as const)(
    'queues studio albums and EPs once per normalized title for %s',
    async (sourceType) => {
      const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
      const release = (releaseGroupMbid: string, releaseTitle: string, type: string) => ({
        releaseGroupMbid,
        releaseTitle,
        type,
        secondaryTypes: [],
      })
      const runner = createSlskdRunner({
        createJob,
        findActiveJob: vi.fn().mockResolvedValue(null),
        resolveReleaseGroups: vi
          .fn()
          .mockResolvedValue([
            release('single', 'Fimbulvinter', 'Single'),
            release('same-title-ep', ' FIMBULVINTER ', 'EP'),
            release('album', 'Fimbulvinter', 'Album'),
            release('duplicate-album', 'Fimbulvinter (Deluxe Edition)', 'Album'),
            release('later-ep', 'fimbulvinter', 'EP'),
            release('ep', 'Rival Dealer', 'EP'),
            { ...release('compilation', 'Collected', 'Album'), secondaryTypes: ['Compilation'] },
            { ...release('live', 'On Stage', 'Album'), secondaryTypes: ['Live'] },
            { ...release('live-ep', 'Live EP', 'EP'), secondaryTypes: ['Live'] },
            release('other', 'Other Release', 'Other'),
          ]),
      })

      expect(
        await runner.queueArtist({
          sourceType,
          userId: 1,
          targetId: 4,
          ...(sourceType === 'combined_approval' ? { lidarrArtistId: 99 } : {}),
          artist: { mbid: 'artist-mbid', name: 'Artist' },
        }),
      ).toEqual({ success: true })
      expect(createJob.mock.calls.map(([job]) => job.releaseGroupMbid)).toEqual(['album', 'ep'])
    },
  )

  it('queues nothing when no release has known studio album or EP types and a usable title', async () => {
    const createJob = vi.fn()
    const findActiveJob = vi.fn()
    const runner = createSlskdRunner({
      createJob,
      findActiveJob,
      resolveReleaseGroups: vi.fn().mockResolvedValue([
        { releaseGroupMbid: 'single', releaseTitle: 'Single', type: 'Single', secondaryTypes: [] },
        { releaseGroupMbid: 'unknown', releaseTitle: 'Unknown', type: 'Album' },
        { releaseGroupMbid: 'blank', releaseTitle: ' ', type: 'EP', secondaryTypes: [] },
      ]),
    })

    expect(
      await runner.queueArtist({
        sourceType: 'standalone_approval',
        userId: 1,
        targetId: 4,
        artist: { mbid: 'artist-mbid', name: 'Artist' },
      }),
    ).toEqual({ success: false })
    expect(findActiveJob).not.toHaveBeenCalled()
    expect(createJob).not.toHaveBeenCalled()
  })

  it('creates pending slskd jobs for standalone approval releases without duplicates', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const findActiveJob = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 5 })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob,
      resolveReleaseGroups: vi.fn().mockResolvedValue([
        { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        { releaseGroupMbid: 'rg-2', releaseTitle: 'Rival Dealer', type: 'EP', secondaryTypes: [] },
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
        .mockResolvedValue([
          { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        ]),
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

  it('reports failure when every release is still in the failed-job cooldown', async () => {
    const runner = createSlskdRunner({
      createJob: vi.fn().mockResolvedValue({ id: 9, state: 'failed' }),
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([
          { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        ]),
    })

    const result = await runner.queueArtist({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
    })

    expect(result.success).toBe(false)
  })
})

describe('createSlskdRunner().queueAlbum', () => {
  it('queues exactly the matched release group', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi.fn().mockResolvedValue([
        { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        { releaseGroupMbid: 'rg-2', releaseTitle: 'Rival Dealer', type: 'EP', secondaryTypes: [] },
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
        .mockResolvedValue([
          { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        ]),
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

  it('reports failure while the matching failed job is cooling down', async () => {
    const runner = createSlskdRunner({
      createJob: vi.fn().mockResolvedValue({ id: 9, state: 'failed' }),
      findActiveJob: vi.fn().mockResolvedValue(null),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([
          { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        ]),
    })

    const result = await runner.queueAlbum({
      sourceType: 'standalone_approval',
      userId: 1,
      targetId: 4,
      artist: { mbid: '11111111-1111-1111-1111-111111111111', name: 'Burial' },
      releaseGroupMbid: 'rg-1',
    })

    expect(result.success).toBe(false)
  })

  it('treats an already-active job as success without creating a duplicate', async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 9, state: 'pending' })
    const runner = createSlskdRunner({
      createJob,
      findActiveJob: vi.fn().mockResolvedValue({ id: 7 }),
      resolveReleaseGroups: vi
        .fn()
        .mockResolvedValue([
          { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
        ]),
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
          .mockResolvedValue([
            { releaseGroupMbid: 'rg-1', releaseTitle: 'Untrue', type: 'Album', secondaryTypes: [] },
          ]),
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

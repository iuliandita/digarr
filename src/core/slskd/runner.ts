import { createHash } from 'node:crypto'

export type SlskdRunnerReleaseGroup = {
  releaseGroupMbid: string
  releaseTitle: string
}

export type SlskdRunnerQueueInput = {
  sourceType: 'standalone_approval' | 'combined_approval'
  userId: number
  targetId: number
  recommendationId?: number
  lidarrArtistId?: number
  artist: {
    mbid: string
    name: string
  }
}

export type SlskdRunnerDeps = {
  resolveReleaseGroups: (artistMbid: string) => Promise<SlskdRunnerReleaseGroup[]>
  findActiveJob: (workKey: string) => Promise<{ id: number } | null>
  createJob: (input: {
    userId: number
    targetId: number
    recommendationId?: number
    sourceType: 'standalone_approval' | 'combined_approval'
    workKey: string
    artistMbid: string
    artistName: string
    releaseGroupMbid: string
    releaseTitle: string
    lidarrArtistId?: number
  }) => Promise<{ id: number }>
}

export function buildSlskdWorkKey(
  targetId: number,
  artistMbid: string,
  releaseGroupMbid: string,
): string {
  const hash = createHash('sha1')
    .update(`${targetId}:${artistMbid}:${releaseGroupMbid}`)
    .digest('hex')
  return `slskd:${hash}`
}

export function createSlskdRunner(deps: SlskdRunnerDeps) {
  async function queueArtist(input: SlskdRunnerQueueInput): Promise<{ success: boolean }> {
    const releaseGroups = await deps.resolveReleaseGroups(input.artist.mbid)

    if (releaseGroups.length === 0) {
      return { success: false }
    }

    let createdOrExisting = 0

    for (const releaseGroup of releaseGroups) {
      const workKey = buildSlskdWorkKey(
        input.targetId,
        input.artist.mbid,
        releaseGroup.releaseGroupMbid,
      )
      const existing = await deps.findActiveJob(workKey)
      if (existing) {
        createdOrExisting++
        continue
      }

      await deps.createJob({
        userId: input.userId,
        targetId: input.targetId,
        recommendationId: input.recommendationId,
        sourceType: input.sourceType,
        workKey,
        artistMbid: input.artist.mbid,
        artistName: input.artist.name,
        releaseGroupMbid: releaseGroup.releaseGroupMbid,
        releaseTitle: releaseGroup.releaseTitle,
        lidarrArtistId: input.lidarrArtistId,
      })
      createdOrExisting++
    }

    return { success: createdOrExisting > 0 }
  }

  return {
    queueArtist,
  }
}

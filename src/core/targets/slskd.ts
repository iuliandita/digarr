import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { DestinationTarget, TargetAddOptions, TargetResult } from './types'

export type SlskdTargetConfig = {
  name: string
  linkedLidarrTargetId?: string
  testConnection: () => Promise<ServiceTestResult>
  queueArtist: (input: {
    sourceType: 'standalone_approval' | 'combined_approval'
    userId: number
    targetId: number
    recommendationId?: number
    lidarrArtistId?: number
    artist: {
      mbid: string
      name: string
    }
  }) => Promise<{ success: boolean }>
}

export function createSlskdTarget(targetId: number, config: SlskdTargetConfig): DestinationTarget {
  return {
    id: `slskd-${targetId}`,
    name: config.name,
    type: 'slskd',
    capabilities: ['addArtist'],
    linkedLidarrTargetId: config.linkedLidarrTargetId,

    async addArtist(
      artist: { mbid: string; name: string },
      options?: TargetAddOptions,
    ): Promise<TargetResult> {
      if (!options?.userId) {
        return {
          success: false,
          targetType: 'slskd',
          targetId,
          error: 'slskd target requires user context',
        }
      }

      try {
        const queued = await config.queueArtist({
          sourceType: options.lidarrArtistId ? 'combined_approval' : 'standalone_approval',
          userId: options.userId,
          targetId,
          recommendationId: options.recommendationId,
          lidarrArtistId: options.lidarrArtistId,
          artist,
        })

        return queued.success
          ? {
              success: true,
              targetType: 'slskd',
              targetId,
            }
          : {
              success: false,
              targetType: 'slskd',
              targetId,
              error: 'No releases were queued for slskd',
            }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'slskd',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      return config.testConnection()
    },
  }
}

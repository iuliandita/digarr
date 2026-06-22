import { createLidarrClient } from '@/core/clients/lidarr'
import { errMsg } from '@/core/validation'
import type { DestinationTarget, TargetAddOptions, TargetResult } from './types'

export type LidarrTargetConfig = {
  url: string
  apiKey: string
  skipTlsVerify?: boolean
  qualityProfileId?: number
  metadataProfileId?: number
  rootFolderId?: number
}

export function createLidarrTarget(
  targetId: number,
  config: LidarrTargetConfig,
): DestinationTarget {
  const client = createLidarrClient(config.url, config.apiKey, config.skipTlsVerify)
  const qualityProfileId = config.qualityProfileId ?? 1
  const metadataProfileId = config.metadataProfileId ?? 1
  const rootFolderId = config.rootFolderId ?? 1

  return {
    id: `lidarr-${targetId}`,
    name: 'Lidarr',
    type: 'lidarr',
    capabilities: ['addArtist', 'addAlbum'],

    async addArtist(
      artist: { mbid: string; name: string },
      options?: TargetAddOptions,
    ): Promise<TargetResult> {
      const effectiveMonitor =
        options?.monitorOption === 'selected' ? 'none' : (options?.monitorOption ?? 'all')

      try {
        const added = await client.addArtist(
          artist.mbid,
          artist.name,
          options?.qualityProfileId ?? qualityProfileId,
          options?.metadataProfileId ?? metadataProfileId,
          options?.rootFolderId ?? rootFolderId,
          { monitorOption: effectiveMonitor },
        )

        // Monitor selected albums after the add
        if (options?.monitorOption === 'selected' && options.selectedAlbumIds?.length && added.id) {
          try {
            const albums = await client.getAlbums(added.id)
            for (const albumMbid of options.selectedAlbumIds) {
              const album = albums.find((a) => a.foreignAlbumId === albumMbid)
              if (album) {
                await client.updateAlbum(album.id, { monitored: true })
              }
            }
          } catch {
            // Best-effort - artist was added, album monitoring is secondary
          }
        }

        return {
          success: true,
          targetType: 'lidarr',
          targetId,
          externalId: added.id,
        }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'lidarr',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async addAlbum(
      album: { artistMbid: string; artistName: string; releaseGroupMbid: string },
      options?: TargetAddOptions,
    ): Promise<TargetResult> {
      try {
        // Gap-fill safe: reuse the artist if already tracked, otherwise add it
        // unmonitored so Lidarr does not grab the whole discography.
        const existing = (await client.getArtists()).find(
          (a) => a.foreignArtistId === album.artistMbid,
        )
        let artistId = existing?.id

        if (!artistId) {
          const added = await client.addArtist(
            album.artistMbid,
            album.artistName,
            options?.qualityProfileId ?? qualityProfileId,
            options?.metadataProfileId ?? metadataProfileId,
            options?.rootFolderId ?? rootFolderId,
            { monitorOption: 'none' },
          )
          artistId = added.id
        }

        const albums = await client.getAlbums(artistId)
        const match = albums.find((a) => a.foreignAlbumId === album.releaseGroupMbid)
        if (!match) {
          return {
            success: false,
            targetType: 'lidarr',
            targetId,
            error: 'album not found in Lidarr',
          }
        }

        await client.updateAlbum(match.id, { monitored: true })
        await client.triggerCommand('AlbumSearch', { albumIds: [match.id] })

        return {
          success: true,
          targetType: 'lidarr',
          targetId,
          externalId: match.id,
        }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'lidarr',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async testConnection() {
      return client.testConnection()
    },
  }
}

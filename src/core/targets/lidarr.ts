import { createLidarrClient } from '@/core/clients/lidarr'
import { errMsg } from '@/core/validation'
import type { DestinationTarget, TargetAddOptions, TargetResult } from './types'

// Lidarr populates an artist's album list asynchronously after the add, so an
// immediate getAlbums often returns an empty/partial list and the selected
// album silently never gets monitored. Poll briefly until the albums appear.
const ALBUM_POLL_ATTEMPTS = 6
const ALBUM_POLL_DELAY_MS = 1500
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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
  const rootFolderId = config.rootFolderId

  // Poll Lidarr until the requested albums appear (or attempts run out),
  // returning whichever of the selected albums are now present.
  async function findSelectedAlbums(artistId: number, albumMbids: string[]) {
    const wanted = new Set(albumMbids)
    for (let attempt = 0; attempt < ALBUM_POLL_ATTEMPTS; attempt++) {
      const albums = await client.getAlbums(artistId)
      const matched = albums.filter((a) => wanted.has(a.foreignAlbumId))
      if (matched.length === wanted.size || attempt === ALBUM_POLL_ATTEMPTS - 1) {
        return matched
      }
      await sleep(ALBUM_POLL_DELAY_MS)
    }
    return []
  }

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

        // Monitor (and search) the selected albums after the add. The artist
        // was added unmonitored, so without this the selected album is never
        // grabbed.
        if (options?.monitorOption === 'selected' && options.selectedAlbumIds?.length && added.id) {
          const matched = await findSelectedAlbums(added.id, options.selectedAlbumIds)
          if (matched.length === 0) {
            return {
              success: false,
              targetType: 'lidarr',
              targetId,
              externalId: added.id,
              error: 'artist added, but the selected album was not found in Lidarr',
            }
          }
          for (const album of matched) {
            await client.updateAlbum(album.id, { monitored: true })
          }
          await client.triggerCommand('AlbumSearch', { albumIds: matched.map((a) => a.id) })
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

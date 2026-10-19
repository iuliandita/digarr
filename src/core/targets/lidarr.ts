import PQueue from 'p-queue'
import { createLidarrClient, type MetadataProfile } from '@/core/clients/lidarr'
import { sleep } from '@/core/sleep'
import { errMsg } from '@/core/validation'
import {
  effectiveMetadataProfile,
  lookupToReleaseGroupTypes,
  metadataProfileRejection,
  profileRejectionMessage,
} from './lidarr-metadata-profile'
import type { DestinationTarget, TargetAddOptions, TargetResult } from './types'

// Lidarr populates an artist's album list asynchronously after the add, so an
// immediate getAlbums often returns an empty/partial list and the selected
// album silently never gets monitored. Poll briefly until the albums appear.
const ALBUM_POLL_ATTEMPTS = 6
const ALBUM_POLL_DELAY_MS = 1500
const NOT_CONFIGURED = 'Lidarr is not configured in Settings > Connections'

export type LidarrTargetConfig = {
  // Missing when the target references an unconfigured server connection;
  // every call then fails loudly instead of the target silently disappearing.
  url?: string
  apiKey?: string
  skipTlsVerify?: boolean
  qualityProfileId?: number
  metadataProfileId?: number
  tags?: number[]
  rootFolderId?: number
}

export function createLidarrTarget(
  targetId: number,
  config: LidarrTargetConfig,
): DestinationTarget {
  const id = `lidarr-${targetId}`
  const configured = Boolean(config.url && config.apiKey)
  const client = configured
    ? createLidarrClient(config.url as string, config.apiKey as string, config.skipTlsVerify)
    : (null as unknown as ReturnType<typeof createLidarrClient>)

  // Explicit picks scoped to another Lidarr target were loaded from that
  // instance, so their IDs mean nothing here; use this target's own defaults.
  function profileIds(options?: TargetAddOptions) {
    const scoped =
      options?.lidarrOptionsTargetId === undefined || options.lidarrOptionsTargetId === id
    return {
      tags: (options?.lidarrOptionsTargetId === id ? options.tags : undefined) ?? config.tags,
      qualityProfileId: (scoped ? options?.qualityProfileId : undefined) ?? config.qualityProfileId,
      metadataProfileId:
        (scoped ? options?.metadataProfileId : undefined) ?? config.metadataProfileId,
      rootFolderId: (scoped ? options?.rootFolderId : undefined) ?? config.rootFolderId,
    }
  }

  function notConfigured(): TargetResult {
    return { success: false, targetType: 'lidarr', targetId, error: NOT_CONFIGURED }
  }

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

  // Explains why Lidarr does not list an album under the artist when its
  // metadata profile filters the release type out; null when the type is allowed
  // or cannot be determined, so the caller keeps its generic message.
  async function profileMismatch(
    releaseGroupMbid: string,
    metadataProfileId: number | undefined,
  ): Promise<string | null> {
    try {
      const [profiles, album] = await Promise.all([
        client.getMetadataProfiles(),
        client.lookupAlbum(releaseGroupMbid),
      ])
      const profile = effectiveMetadataProfile(profiles, metadataProfileId)
      if (!profile || !album) return null
      const rejection = metadataProfileRejection(profile, lookupToReleaseGroupTypes(album))
      return rejection ? profileRejectionMessage(profile.name, rejection) : null
    } catch {
      return null
    }
  }

  return {
    id,
    name: 'Lidarr',
    type: 'lidarr',
    capabilities: ['addArtist', 'addAlbum'],

    async addArtist(
      artist: { mbid: string; name: string },
      options?: TargetAddOptions,
    ): Promise<TargetResult> {
      if (!configured) return notConfigured()
      const effectiveMonitor =
        options?.monitorOption === 'selected' ? 'none' : (options?.monitorOption ?? 'none')
      const ids = profileIds(options)

      try {
        const existing = options?.retryExisting ? await client.findArtistByMbid(artist.mbid) : null
        const added =
          existing ??
          (await client.addArtist(
            artist.mbid,
            artist.name,
            ids.qualityProfileId,
            ids.metadataProfileId,
            ids.rootFolderId,
            { monitorOption: effectiveMonitor, ...(ids.tags ? { tags: ids.tags } : {}) },
          ))

        // Monitor (and search) the selected albums after the add. The artist
        // was added unmonitored, so without this the selected album is never
        // grabbed. This step is best-effort: the artist add already succeeded,
        // so a monitoring failure must NOT fail the result (that would drop the
        // Lidarr artist id and orphan the artist -> a retry re-adds a duplicate).
        // Partial/failed monitoring surfaces as a warning instead.
        let warning: string | undefined
        if (options?.monitorOption === 'selected' && options.selectedAlbumIds?.length && added.id) {
          const wanted = options.selectedAlbumIds
          const matched = await findSelectedAlbums(added.id, wanted)
          if (matched.length === 0) {
            warning =
              'artist added, but the selected album was not found in Lidarr (it may still be populating; retry to finish monitoring)'
          } else {
            try {
              const albumIds = matched.map((a) => a.id)
              await client.setAlbumsMonitored(albumIds, true)
              await client.triggerCommand('AlbumSearch', { albumIds })
              if (matched.length < wanted.length) {
                warning = `artist added; ${matched.length} of ${wanted.length} selected albums monitored, the rest were not found in Lidarr`
              }
            } catch (monErr: unknown) {
              warning = `artist added, but monitoring the selected album failed: ${errMsg(monErr)}`
            }
          }
        }

        return {
          success: true,
          targetType: 'lidarr',
          targetId,
          externalId: added.id,
          ...(warning ? { warning } : {}),
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
      if (!configured) return notConfigured()
      try {
        // Gap-fill safe: reuse the artist if already tracked, otherwise add it
        // unmonitored so Lidarr does not grab the whole discography.
        const existing = await client.findArtistByMbid(album.artistMbid)
        let artistId = existing?.id
        let metadataProfileId = existing?.metadataProfileId ?? profileIds(options).metadataProfileId

        if (!artistId) {
          const ids = profileIds(options)
          const added = await client.addArtist(
            album.artistMbid,
            album.artistName,
            ids.qualityProfileId,
            ids.metadataProfileId,
            ids.rootFolderId,
            { monitorOption: 'none', ...(ids.tags ? { tags: ids.tags } : {}) },
          )
          artistId = added.id
          metadataProfileId = added.metadataProfileId ?? metadataProfileId
        }

        // A just-added artist populates its album list asynchronously (see the
        // poll note at the top); an already-tracked artist has it ready.
        const albums = existing
          ? await client.getAlbums(artistId)
          : await findSelectedAlbums(artistId, [album.releaseGroupMbid])
        const match = albums.find((a) => a.foreignAlbumId === album.releaseGroupMbid)
        if (!match) {
          return {
            success: false,
            targetType: 'lidarr',
            targetId,
            error:
              (await profileMismatch(album.releaseGroupMbid, metadataProfileId)) ??
              (existing
                ? 'album not found in Lidarr'
                : 'album not found in Lidarr after adding artist (metadata may still be refreshing)'),
          }
        }

        await client.setAlbumsMonitored([match.id], true)
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

    async unaddableAlbums(albums) {
      if (!configured || albums.length === 0) return new Set<string>()
      const profiles = await client.getMetadataProfiles()
      const fallback = effectiveMetadataProfile(profiles, config.metadataProfileId)
      const byArtist = new Map<string, MetadataProfile | undefined>()
      const queue = new PQueue({ concurrency: 4 })
      await Promise.all(
        [...new Set(albums.map((album) => album.artistMbid))].map((mbid) =>
          queue.add(async () => {
            const existing = await client.findArtistByMbid(mbid)
            byArtist.set(
              mbid,
              existing ? effectiveMetadataProfile(profiles, existing.metadataProfileId) : fallback,
            )
          }),
        ),
      )
      const unaddable = new Set<string>()
      for (const album of albums) {
        const profile = byArtist.get(album.artistMbid)
        if (profile && metadataProfileRejection(profile, album.types)) {
          unaddable.add(album.releaseGroupMbid)
        }
      }
      return unaddable
    },

    async testConnection() {
      if (!configured) return { success: false, message: NOT_CONFIGURED }
      return client.testConnection()
    },
  }
}

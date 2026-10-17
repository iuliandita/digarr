import { Hono } from 'hono'
import { createLidarrClient } from '@/core/clients/lidarr'
import {
  resolveLidarrTargetConnection,
  resolveLidarrTargetDefaults,
  serverLidarrConnection,
} from '@/core/targets/lidarr-connection'
import { logAndSanitize } from '@/core/validation'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { notFoundProblem } from '@/server/helpers/problem'
import { adminGuard, effectiveIsAdmin } from '@/server/middleware/admin-guard'
import { approveOptionsQuerySchema, lidarrAddSchema } from '@/server/schemas/lidarr'
import { zJson, zQuery } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export function lidarrRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  async function getClient() {
    const connection = serverLidarrConnection(await deps.getSettings())
    if (!connection) throw new Error('Lidarr not configured')
    return createLidarrClient(connection.url, connection.apiKey, connection.skipTlsVerify)
  }

  router.onError((err, c) => c.json({ error: logAndSanitize(err, 'lidarr-route') }, 500))

  router.get('/api/v1/lidarr/stats', adminGuard(deps.getUserById), async (c) => {
    const client = await getClient()
    const artists = await client.getArtists()
    return c.json({
      artists: artists.length,
      monitored: artists.filter((a) => a.monitored).length,
    })
  })

  router.get('/api/v1/lidarr/metadataprofiles', adminGuard(deps.getUserById), async (c) => {
    const client = await getClient()
    return c.json(await client.getMetadataProfiles())
  })

  router.get('/api/v1/lidarr/profiles', adminGuard(deps.getUserById), async (c) => {
    const client = await getClient()
    return c.json(await client.getQualityProfiles())
  })

  router.get('/api/v1/lidarr/rootfolders', adminGuard(deps.getUserById), async (c) => {
    const client = await getClient()
    return c.json(await client.getRootFolders())
  })

  // Defaults for the server connection: the user's preferences, global fallback.
  async function serverDefaults(userId: number | undefined) {
    const settings = await deps.getSettings()
    const globalPrefs = settings?.preferences ?? null
    const prefs = mergePreferences(
      (await resolveUserPreferences(deps.getUserById, globalPrefs, userId)) ?? globalPrefs,
    )
    return {
      qualityProfileId: prefs.qualityProfileId,
      metadataProfileId: prefs.metadataProfileId,
      rootFolderId: prefs.rootFolderId,
    }
  }

  // Non-admin picker for the approve dialog. The four GETs above stay
  // admin-only because they expose library structure and free-space; this
  // endpoint returns only the fields the picker needs. The explicit .map
  // projection is the security boundary -- never c.json a raw client object,
  // as RootFolder carries freeSpace (and the types may gain fields later).
  // With ?targetId the lists and defaults come from the Lidarr instance that
  // target actually uses, so a separate instance never shows server IDs.
  router.get('/api/v1/lidarr/approve-options', zQuery(approveOptionsQuerySchema), async (c) => {
    const { targetId } = c.req.valid('query')
    const userId = c.get('userId')
    let client: ReturnType<typeof createLidarrClient>
    let defaults: { qualityProfileId?: number; metadataProfileId?: number; rootFolderId?: number }
    if (targetId === undefined) {
      client = await getClient()
      defaults = await serverDefaults(userId)
    } else {
      const target = await deps.targetQueries.getTarget(targetId)
      const caller = userId ? await deps.getUserById(userId) : null
      if (
        target?.type !== 'lidarr' ||
        !caller ||
        (!effectiveIsAdmin(c, caller) && target.userId !== userId)
      ) {
        return notFoundProblem(c, 'target-not-found', 'Target not found', 'errors.target.notFound')
      }
      const connection = resolveLidarrTargetConnection(target.config, await deps.getSettings())
      if (!connection) throw new Error('Lidarr not configured')
      client = createLidarrClient(connection.url, connection.apiKey, connection.skipTlsVerify)
      defaults = resolveLidarrTargetDefaults(
        target.config,
        await serverDefaults(target.userId ?? undefined),
      )
    }
    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      client.getQualityProfiles(),
      client.getMetadataProfiles(),
      client.getRootFolders(),
    ])
    return c.json({
      qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
      metadataProfiles: metadataProfiles.map((p) => ({ id: p.id, name: p.name })),
      // path is kept as the picker label; freeSpace and any other fields drop.
      rootFolders: rootFolders.map((f) => ({ id: f.id, path: f.path })),
      defaults: {
        qualityProfileId: defaults.qualityProfileId ?? null,
        metadataProfileId: defaults.metadataProfileId ?? null,
        rootFolderId: defaults.rootFolderId ?? null,
      },
    })
  })

  router.post(
    '/api/v1/lidarr/add',
    adminGuard(deps.getUserById),
    zJson(lidarrAddSchema),
    async (c) => {
      const { foreignArtistId, artistName, qualityProfileId, metadataProfileId, rootFolderId } =
        c.req.valid('json')
      const client = await getClient()
      const artist = await client.addArtist(
        foreignArtistId,
        artistName,
        qualityProfileId ?? 1,
        metadataProfileId ?? 1,
        rootFolderId,
      )
      return c.json(artist)
    },
  )

  return router
}

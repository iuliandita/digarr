import { Hono } from 'hono'
import { createLidarrClient } from '@/core/clients/lidarr'
import {
  type LidarrDefaults,
  resolveLidarrTargetConnection,
  resolveLidarrTargetDefaults,
  serverLidarrConnection,
} from '@/core/targets/lidarr-connection'
import { logAndSanitize } from '@/core/validation'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { notFoundProblem } from '@/server/helpers/problem'
import { adminGuard } from '@/server/middleware/admin-guard'
import {
  approveOptionsQuerySchema,
  lidarrAddSchema,
  lidarrTagSchema,
} from '@/server/schemas/lidarr'
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
  async function picker(targetId: number | undefined, userId: number | undefined) {
    let client: ReturnType<typeof createLidarrClient>
    let defaults: LidarrDefaults
    if (targetId === undefined) {
      client = await getClient()
      defaults = await serverDefaults(userId)
    } else {
      const target = await deps.targetQueries.getTarget(targetId)
      const caller = userId ? await deps.getUserById(userId) : null
      if (target?.type !== 'lidarr' || !caller || (!caller.isAdmin && target.userId !== userId)) {
        return null
      }
      const connection = resolveLidarrTargetConnection(target.config, await deps.getSettings())
      if (!connection) throw new Error('Lidarr not configured')
      client = createLidarrClient(connection.url, connection.apiKey, connection.skipTlsVerify)
      defaults = resolveLidarrTargetDefaults(
        target.config,
        await serverDefaults(target.userId ?? undefined),
      )
    }
    return { client, defaults }
  }

  router.post(
    '/api/v1/lidarr/tags',
    zQuery(approveOptionsQuerySchema),
    zJson(lidarrTagSchema),
    async (c) => {
      const resolved = await picker(c.req.valid('query').targetId, c.get('userId'))
      if (!resolved)
        return notFoundProblem(c, 'target-not-found', 'Target not found', 'errors.target.notFound')
      const tag = await resolved.client.createTag(c.req.valid('json').label)
      return c.json({ id: tag.id, label: tag.label }, 201)
    },
  )

  router.get('/api/v1/lidarr/approve-options', zQuery(approveOptionsQuerySchema), async (c) => {
    const resolved = await picker(c.req.valid('query').targetId, c.get('userId'))
    if (!resolved)
      return notFoundProblem(c, 'target-not-found', 'Target not found', 'errors.target.notFound')
    const { client, defaults } = resolved
    const [qualityProfiles, metadataProfiles, rootFolders, tags] = await Promise.all([
      client.getQualityProfiles(),
      client.getMetadataProfiles(),
      client.getRootFolders(),
      client.getTags(),
    ])
    return c.json({
      tags: tags.map((tag) => ({ id: tag.id, label: tag.label })),
      qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
      metadataProfiles: metadataProfiles.map((p) => ({ id: p.id, name: p.name })),
      // path is kept as the picker label; freeSpace and any other fields drop.
      rootFolders: rootFolders.map((f) => ({ id: f.id, path: f.path })),
      defaults: {
        tags: defaults.tags ?? [],
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
      const {
        foreignArtistId,
        artistName,
        qualityProfileId,
        metadataProfileId,
        rootFolderId,
        tags,
        monitorOption,
      } = c.req.valid('json')
      const client = await getClient()
      const artist = await client.addArtist(
        foreignArtistId,
        artistName,
        qualityProfileId ?? 1,
        metadataProfileId ?? 1,
        rootFolderId,
        { tags, monitorOption },
      )
      return c.json(artist)
    },
  )

  return router
}

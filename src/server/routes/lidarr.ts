import { Hono } from 'hono'
import { createLidarrClient } from '@/core/clients/lidarr'
import { errMsg } from '@/core/validation'
import type { AppDependencies } from '@/server'
import { adminGuard } from '@/server/middleware/admin-guard'
import { lidarrAddSchema } from '@/server/schemas/lidarr'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export function lidarrRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  async function getClient() {
    const settings = await deps.getSettings()
    if (!settings?.lidarrUrl || !settings?.lidarrApiKey) {
      throw new Error('Lidarr not configured')
    }
    return createLidarrClient(
      settings.lidarrUrl as string,
      settings.lidarrApiKey as string,
      (settings.skipTlsVerify as boolean) ?? false,
    )
  }

  router.onError((err, c) => c.json({ error: errMsg(err) }, 500))

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

  // Non-admin picker for the approve dialog. The four GETs above stay
  // admin-only because they expose library structure and free-space; this
  // endpoint returns only the fields the picker needs. The explicit .map
  // projection is the security boundary -- never c.json a raw client object,
  // as RootFolder carries freeSpace (and the types may gain fields later).
  router.get('/api/v1/lidarr/approve-options', async (c) => {
    const client = await getClient()
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
        rootFolderId ?? 1,
      )
      return c.json(artist)
    },
  )

  return router
}

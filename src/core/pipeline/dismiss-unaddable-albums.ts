import PQueue from 'p-queue'
import type { ReleaseGroupTypes } from '@/core/targets/lidarr-metadata-profile'
import type { DestinationTarget } from '@/core/targets/types'
import { errMsg } from '@/core/validation'
import type { StoreDb } from './store'

const MAX_PER_RUN = 200
const LOOKUP_CONCURRENCY = 4

/**
 * Moves pending album recommendations that no enabled Lidarr target can add
 * (its metadata profile filters the release type out) to `unaddable`, so they
 * stop showing up and failing on approve. Same fail-soft rules as
 * dropUnaddableAlbums: anything unknown or erroring stays pending.
 */
export async function dismissUnaddableAlbums(
  db: Pick<StoreDb, 'listPendingAlbumRecommendations' | 'markRecommendationUnaddable'>,
  userId: number,
  getTargets: (() => Promise<DestinationTarget[]>) | undefined,
): Promise<number> {
  const { listPendingAlbumRecommendations, markRecommendationUnaddable } = db
  if (!getTargets || !listPendingAlbumRecommendations || !markRecommendationUnaddable) return 0

  const pending = await listPendingAlbumRecommendations(userId, MAX_PER_RUN)
  if (pending.length === 0) return 0

  let targets: DestinationTarget[]
  try {
    targets = (await getTargets()).filter((t) => t.type === 'lidarr' && t.unaddableAlbums)
  } catch (err) {
    console.warn(`[pipeline] could not load targets for the pending album sweep: ${errMsg(err)}`)
    return 0
  }
  const lookupTarget = targets.find((t) => t.lookupAlbumTypes)
  if (!lookupTarget?.lookupAlbumTypes) return 0
  const lookupAlbumTypes = lookupTarget.lookupAlbumTypes.bind(lookupTarget)

  const typesByRg = new Map<string, ReleaseGroupTypes>()
  const queue = new PQueue({ concurrency: LOOKUP_CONCURRENCY })
  await Promise.all(
    [...new Set(pending.map((rec) => rec.releaseGroupMbid))].map((rg) =>
      queue.add(async () => {
        try {
          const types = await lookupAlbumTypes(rg)
          if (types) typesByRg.set(rg, types)
        } catch (err) {
          console.warn(`[pipeline] album type lookup failed for ${rg}: ${errMsg(err)}`)
        }
      }),
    ),
  )

  const albums = pending.flatMap((rec) => {
    const types = typesByRg.get(rec.releaseGroupMbid)
    return types
      ? [{ artistMbid: rec.artistMbid, releaseGroupMbid: rec.releaseGroupMbid, types }]
      : []
  })
  if (albums.length === 0) return 0

  const perTarget = await Promise.all(
    targets.map((target) =>
      (target.unaddableAlbums?.(albums) ?? Promise.resolve(new Set<string>())).catch(
        (err: unknown) => {
          console.warn(`[pipeline] ${target.id} metadata profile check failed: ${errMsg(err)}`)
          return new Set<string>()
        },
      ),
    ),
  )
  const unaddable = new Set(
    albums
      .map((album) => album.releaseGroupMbid)
      .filter((rg) => perTarget.every((rejected) => rejected.has(rg))),
  )

  const messages = new Map<string, string | null>()
  for (const rg of unaddable) {
    const message = await lookupTarget.albumProfileMessage?.(rg).catch(() => null)
    messages.set(rg, message ?? null)
  }

  let dismissed = 0
  for (const rec of pending) {
    if (!unaddable.has(rec.releaseGroupMbid)) continue
    if (await markRecommendationUnaddable(rec.id, messages.get(rec.releaseGroupMbid) ?? null)) {
      dismissed++
    }
  }
  return dismissed
}

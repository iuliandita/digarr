import type { DestinationTarget } from '@/core/targets/types'
import type { ResolvedArtist } from '@/core/types'
import { errMsg } from '@/core/validation'

/**
 * Drop album-kind candidates that no enabled Lidarr target would list under
 * the artist (its metadata profile filters the release type out), so they can
 * never be added. Candidates with unknown types, users without a Lidarr target,
 * and targets that fail to answer all keep every candidate.
 */
export async function dropUnaddableAlbums<T extends ResolvedArtist>(
  candidates: T[],
  getTargets: (() => Promise<DestinationTarget[]>) | undefined,
): Promise<T[]> {
  const albums = candidates.flatMap((c) =>
    c.kind === 'album' && c.releaseGroupMbid && c.releaseGroupTypes
      ? [{ artistMbid: c.mbid, releaseGroupMbid: c.releaseGroupMbid, types: c.releaseGroupTypes }]
      : [],
  )
  if (albums.length === 0 || !getTargets) return candidates

  let targets: DestinationTarget[]
  try {
    targets = (await getTargets()).filter((t) => t.type === 'lidarr' && t.unaddableAlbums)
  } catch (err) {
    console.warn(`[pipeline] could not load targets for the album profile check: ${errMsg(err)}`)
    return candidates
  }
  if (targets.length === 0) return candidates

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
  return candidates.filter(
    (c) =>
      !(
        c.kind === 'album' &&
        c.releaseGroupMbid &&
        perTarget.every((unaddable) => unaddable.has(c.releaseGroupMbid as string))
      ),
  )
}

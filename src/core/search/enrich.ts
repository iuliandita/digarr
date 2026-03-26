import type { MergedSearchResult } from './multi-source'

type SearchImageDeps = {
  getCachedImages: (mbids: string[]) => Promise<Map<string, string>>
  lookupLidarrImage?: (mbid: string) => Promise<string | undefined>
  cacheImage?: (mbid: string, url: string) => Promise<void>
}

function addImage(result: MergedSearchResult, url: string, source: string): MergedSearchResult {
  if (result.images.some((image) => image.url === url)) return result

  return {
    ...result,
    images: [...result.images, { url, source }],
  }
}

export async function enrichSearchResultsWithImages(
  results: MergedSearchResult[],
  deps: SearchImageDeps,
): Promise<MergedSearchResult[]> {
  const missing = results.filter((result) => result.images.length === 0 && result.mbid)
  if (missing.length === 0) return results

  const mbids = [...new Set(missing.map((result) => result.mbid).filter(Boolean))] as string[]
  const cached = await deps.getCachedImages(mbids)

  let enriched = results.map((result) => {
    if (!result.mbid || result.images.length > 0) return result

    const cachedUrl = cached.get(result.mbid)
    return cachedUrl ? addImage(result, cachedUrl, 'cache') : result
  })

  if (!deps.lookupLidarrImage) return enriched

  const stillMissing = enriched.filter((result) => result.images.length === 0 && result.mbid)
  if (stillMissing.length === 0) return enriched

  const lookedUp = await Promise.all(
    stillMissing.map(async (result) => {
      try {
        const mbid = result.mbid as string
        const url = await deps.lookupLidarrImage?.(mbid)
        if (!url) return [mbid, undefined] as const

        try {
          await deps.cacheImage?.(mbid, url)
        } catch {
          // A cache write failure should not block search results.
        }

        return [mbid, url] as const
      } catch {
        return [result.mbid as string, undefined] as const
      }
    }),
  )

  const fetched = new Map(
    lookedUp.filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  )

  enriched = enriched.map((result) => {
    if (!result.mbid || result.images.length > 0) return result

    const fetchedUrl = fetched.get(result.mbid)
    return fetchedUrl ? addImage(result, fetchedUrl, 'lidarr') : result
  })

  return enriched
}

import { inArray } from 'drizzle-orm'
import PQueue from 'p-queue'
import { createLidarrClient } from '@/core/clients/lidarr'
import { isValidMbid } from '@/core/validation'
import type { Database } from '@/db'
import { artists } from '@/db/schema'

const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 2000
const LOOKUP_CONCURRENCY = 4

type CacheEntry = { url: string | null; expiresAt: number }
type Lookup = (term: string) => Promise<unknown[]>

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string | null>>()
const queue = new PQueue({ concurrency: LOOKUP_CONCURRENCY })

export function resetListeningImageCache(): void {
  cache.clear()
  inflight.clear()
}

function remember(key: string, url: string | null): void {
  cache.delete(key)
  cache.set(key, { url, expiresAt: Date.now() + (url ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function pickImage(results: unknown[]): string | null {
  const result = results[0] as Record<string, unknown> | undefined
  const images = (result?.images ?? []) as Array<{ coverType: string; remoteUrl?: string }>
  const img =
    images.find((i) => i.coverType === 'poster' && i.remoteUrl) ?? images.find((i) => i.remoteUrl)
  return img?.remoteUrl ?? null
}

// Resolves to undefined on failure so the caller skips the artist; failures are never cached.
function cachedLookup(
  key: string,
  term: string,
  lookup: Lookup,
): Promise<string | null | undefined> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url)

  let pending = inflight.get(key)
  if (!pending) {
    pending = queue
      .add(() => lookup(term))
      .then((results) => {
        const url = pickImage(results ?? [])
        remember(key, url)
        return url
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending.catch(() => undefined)
}

async function knownImages(db: Database, mbids: string[]): Promise<Map<string, string>> {
  const valid = mbids.filter(isValidMbid)
  if (valid.length === 0) return new Map()
  try {
    const rows = await db
      .select({ mbid: artists.mbid, imageUrl: artists.imageUrl })
      .from(artists)
      .where(inArray(artists.mbid, valid))
    const known = new Map<string, string>()
    for (const row of rows) if (row.imageUrl) known.set(row.mbid, row.imageUrl)
    return known
  } catch {
    return new Map()
  }
}

export async function enrichImages(
  db: Database,
  entries: Array<{ artist: string; mbid?: string; imageUrl?: string }>,
  deps: {
    lidarrUrl: string | null
    lidarrApiKey: string | null
    skipTlsVerify: boolean
  },
  lookupOverride?: Lookup,
): Promise<void> {
  if (
    !deps.lidarrUrl ||
    !deps.lidarrApiKey ||
    deps.lidarrApiKey === '***' ||
    !entries.some((e) => !e.imageUrl)
  ) {
    return
  }
  try {
    const lookup: Lookup =
      lookupOverride ??
      createLidarrClient(deps.lidarrUrl, deps.lidarrApiKey, deps.skipTlsVerify).lookupArtist
    const base = deps.lidarrUrl.replace(/\/+$/, '')

    const firstByArtist = new Map<string, { artist: string; mbid?: string }>()
    for (const entry of entries) {
      if (entry.imageUrl || firstByArtist.has(entry.artist)) continue
      firstByArtist.set(entry.artist, entry)
    }

    const known = await knownImages(
      db,
      [...firstByArtist.values()].flatMap((e) => (e.mbid ? [e.mbid] : [])),
    )
    const imageByArtist = new Map<string, string>()
    const misses: Array<{ artist: string; term: string }> = []
    for (const [artist, entry] of firstByArtist) {
      const dbImage = entry.mbid ? known.get(entry.mbid) : undefined
      if (dbImage) imageByArtist.set(artist, dbImage)
      else misses.push({ artist, term: entry.mbid ? `lidarr:${entry.mbid}` : entry.artist })
    }

    await Promise.all(
      misses.map(async ({ artist, term }) => {
        const url = await cachedLookup(`${base}\n${term}`, term, lookup)
        if (url) imageByArtist.set(artist, url)
      }),
    )

    for (const entry of entries) {
      const url = imageByArtist.get(entry.artist)
      if (!entry.imageUrl && url) entry.imageUrl = url
    }
  } catch {
    // silently fail
  }
}

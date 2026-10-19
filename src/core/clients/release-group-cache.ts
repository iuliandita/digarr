import type { MBReleaseGroup } from './musicbrainz'

// expiresAt caps the entry when the catalog came from an older persistent copy.
type Catalog = { groups: MBReleaseGroup[]; cacheable: boolean; expiresAt?: number }

export function createReleaseGroupCache({
  now = Date.now,
  maxEntries = 2000,
  ttlMs = 24 * 60 * 60 * 1000,
}: {
  now?: () => number
  maxEntries?: number
  ttlMs?: number
} = {}) {
  const entries = new Map<string, { groups: MBReleaseGroup[]; expiresAt: number }>()
  const inFlight = new Map<string, Promise<MBReleaseGroup[]>>()

  function store(artistMbid: string, groups: MBReleaseGroup[], expiresAt?: number) {
    if (maxEntries <= 0) return
    entries.delete(artistMbid)
    entries.set(artistMbid, {
      groups: structuredClone(groups),
      expiresAt: Math.min(now() + ttlMs, expiresAt ?? Number.POSITIVE_INFINITY),
    })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }
  }

  return {
    set(artistMbid: string, groups: MBReleaseGroup[]): void {
      store(artistMbid, groups)
    },

    async get(artistMbid: string, load: () => Promise<Catalog>): Promise<MBReleaseGroup[]> {
      const entry = entries.get(artistMbid)
      if (entry) {
        entries.delete(artistMbid)
        if (entry.expiresAt > now()) {
          entries.set(artistMbid, entry)
          return structuredClone(entry.groups)
        }
      }
      let pending = inFlight.get(artistMbid)
      if (!pending) {
        pending = load()
          .then(({ groups, cacheable, expiresAt }) => {
            if (cacheable) store(artistMbid, groups, expiresAt)
            return groups
          })
          .finally(() => {
            inFlight.delete(artistMbid)
          })
        inFlight.set(artistMbid, pending)
      }
      return structuredClone(await pending)
    },
  }
}

export type ReleaseGroupCache = ReturnType<typeof createReleaseGroupCache>

export const releaseGroupCache = createReleaseGroupCache()

import type { MBReleaseGroup } from './musicbrainz'

type Catalog = { groups: MBReleaseGroup[]; cacheable: boolean }

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

  return {
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
          .then(({ groups, cacheable }) => {
            if (cacheable && maxEntries > 0) {
              entries.set(artistMbid, { groups: structuredClone(groups), expiresAt: now() + ttlMs })
              while (entries.size > maxEntries) {
                const oldest = entries.keys().next().value
                if (oldest !== undefined) entries.delete(oldest)
              }
            }
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

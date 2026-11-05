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
  const inFlight = new Map<
    string,
    { promise: Promise<MBReleaseGroup[]>; controller: AbortController; waiters: number }
  >()

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

    async get(
      artistMbid: string,
      load: (signal: AbortSignal) => Promise<Catalog>,
      signal?: AbortSignal,
    ): Promise<MBReleaseGroup[]> {
      signal?.throwIfAborted()
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
        const controller = new AbortController()
        const shared = {
          controller,
          waiters: 0,
          promise: Promise.resolve()
            .then(() => load(controller.signal))
            .then(({ groups, cacheable, expiresAt }) => {
              controller.signal.throwIfAborted()
              if (cacheable) store(artistMbid, groups, expiresAt)
              return groups
            })
            .finally(() => {
              if (inFlight.get(artistMbid)?.controller === controller) inFlight.delete(artistMbid)
            }),
        }
        pending = shared
        inFlight.set(artistMbid, pending)
      }
      pending.waiters += 1
      let onAbort: (() => void) | undefined
      try {
        const groups = await new Promise<MBReleaseGroup[]>((resolve, reject) => {
          onAbort = () => reject(signal?.reason)
          signal?.addEventListener('abort', onAbort, { once: true })
          pending.promise.then(resolve, reject)
          if (signal?.aborted) onAbort()
        })
        return structuredClone(groups)
      } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort)
        pending.waiters -= 1
        // A disconnect must not cancel another caller's shared catalog lookup.
        if (pending.waiters === 0) {
          if (inFlight.get(artistMbid) === pending) inFlight.delete(artistMbid)
          pending.controller.abort()
        }
      }
    },
  }
}

export type ReleaseGroupCache = ReturnType<typeof createReleaseGroupCache>

export const releaseGroupCache = createReleaseGroupCache()

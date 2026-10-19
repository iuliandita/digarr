export type MusicBrainzCacheKind =
  | 'artist'
  | 'artist-relations'
  | 'artist-search'
  | 'release-groups'
  | 'recordings'

export type MusicBrainzCacheEntry = { status: 200; body: unknown } | { status: 404; body: null }
export type MusicBrainzCacheHit = MusicBrainzCacheEntry & { expiresAt: number }

export type MusicBrainzCacheStore = {
  get(key: string): Promise<MusicBrainzCacheHit | null>
  set(key: string, kind: MusicBrainzCacheKind, entry: MusicBrainzCacheEntry): Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000

// Artist metadata and recordings change rarely. Release groups feed Release
// Radar's recent window, so they stay as fresh as the in-memory cache (24 h).
export const MUSICBRAINZ_CACHE_TTL_MS: Record<MusicBrainzCacheKind, number> = {
  artist: 30 * DAY_MS,
  'artist-relations': 30 * DAY_MS,
  'artist-search': 3 * DAY_MS,
  'release-groups': DAY_MS,
  recordings: 30 * DAY_MS,
}

export const MUSICBRAINZ_NOT_FOUND_TTL_MS = DAY_MS

export const noopMusicBrainzCacheStore: MusicBrainzCacheStore = {
  get: async () => null,
  set: async () => {},
}

let activeStore: MusicBrainzCacheStore = noopMusicBrainzCacheStore

export function setMusicBrainzCacheStore(store: MusicBrainzCacheStore): void {
  activeStore = store
}

export function getMusicBrainzCacheStore(): MusicBrainzCacheStore {
  return activeStore
}

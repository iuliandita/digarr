// Lookups against Apple's public iTunes Search API. It needs no account and
// answers cross-origin requests, so the browser asks it directly.

export const APPLE_PREVIEW_HOST = 'https://audio-ssl.itunes.apple.com/'
// Short enough that playback still counts as started by the user's click.
const APPLE_LOOKUP_TIMEOUT_MS = 4000

export const normalizeArtistName = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

// Apple Music and iTunes Store artist URLs both end in the numeric artist ID.
export function appleArtistId(appleMusicUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(appleMusicUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== 'music.apple.com' && parsed.hostname !== 'itunes.apple.com') return null
  return parsed.pathname.match(/\/artist\/(?:[^/]+\/)?(?:id)?(\d+)\/?$/)?.[1] ?? null
}

export type AppleSong = {
  wrapperType?: string
  kind?: string
  trackId?: number
  artistName?: string
  trackName?: string
  previewUrl?: string
}

export type AppleSongLookup =
  | { songs: AppleSong[]; reason?: undefined }
  | { songs: null; reason: 'lookup-failed' | 'no-match' }

type AppleArtist = { wrapperType?: string; artistId?: number; artistName?: string }

async function fetchResults<T>(url: string, signal: AbortSignal): Promise<T[] | null> {
  const res = await fetch(url, { signal })
  if (!res.ok) return null
  const data = (await res.json()) as { results?: T[] }
  return Array.isArray(data?.results) ? data.results : null
}

/**
 * The artist's songs, most popular first. An Apple Music artist link from
 * MusicBrainz gives the artist ID directly. Without one the artist is searched
 * by name and only an exact name match is used, since a bare name also matches
 * covers and tributes. The search is over artists, not songs: Apple credits
 * songs under a romanized name for some artists it lists in their own script.
 */
export async function lookupAppleSongs(
  appleMusicUrl: string | undefined,
  artistName: string,
): Promise<AppleSongLookup> {
  const signal = AbortSignal.timeout(APPLE_LOOKUP_TIMEOUT_MS)
  try {
    let artistId = appleMusicUrl ? appleArtistId(appleMusicUrl) : null
    if (!artistId) {
      const artists = await fetchResults<AppleArtist>(
        `https://itunes.apple.com/search?${new URLSearchParams({
          term: artistName,
          media: 'music',
          entity: 'musicArtist',
          attribute: 'artistTerm',
          limit: '10',
        }).toString()}`,
        signal,
      )
      if (!artists) return { songs: null, reason: 'lookup-failed' }
      const match = artists.find(
        (a) =>
          Number.isInteger(a.artistId) &&
          typeof a.artistName === 'string' &&
          normalizeArtistName(a.artistName) === normalizeArtistName(artistName),
      )
      if (!match) return { songs: null, reason: 'no-match' }
      artistId = String(match.artistId)
    }
    const results = await fetchResults<AppleSong>(
      `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=10`,
      signal,
    )
    if (!results) return { songs: null, reason: 'lookup-failed' }
    const songs = results.filter((r) => r.wrapperType === 'track' && r.kind === 'song')
    if (songs.length === 0) return { songs: null, reason: 'no-match' }
    return { songs }
  } catch {
    return { songs: null, reason: 'lookup-failed' }
  }
}

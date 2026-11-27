// Apple preview songs come from Digarr's own /api/v1/preview/apple route: the
// server asks Apple's iTunes Search API, so the browser never contacts Apple
// for a lookup. It contacts Apple only when the inline Apple Music player is
// loaded.

import type { AppleSong, AppleSongLookup } from '@/core/clients/itunes'
import { getApplePreviewSongs } from './api'

export type { AppleSong, AppleSongLookup }

// The server already drops clips from any other host; the audio proxy checks it again.
export const APPLE_PREVIEW_HOST = 'https://audio-ssl.itunes.apple.com/'
// The server spends at most four seconds on Apple; allow for the round trip.
const APPLE_LOOKUP_TIMEOUT_MS = 5000

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

/**
 * The artist's songs, most popular first, looked up by the server: by the
 * artist ID in an Apple Music link from MusicBrainz, otherwise by a name
 * search that the server uses only when exactly one artist has that name.
 */
export async function lookupAppleSongs(
  appleMusicUrl: string | undefined,
  artistName: string,
): Promise<AppleSongLookup> {
  const name = artistName.trim()
  if (!name) return { songs: null, reason: 'no-match' }
  const id = appleMusicUrl ? appleArtistId(appleMusicUrl) : null
  try {
    const lookup = await getApplePreviewSongs(
      { name, ...(id ? { id } : {}) },
      AbortSignal.timeout(APPLE_LOOKUP_TIMEOUT_MS),
    )
    if (Array.isArray(lookup?.songs)) return { songs: lookup.songs }
    return { songs: null, reason: lookup?.reason === 'no-match' ? 'no-match' : 'lookup-failed' }
  } catch {
    return { songs: null, reason: 'lookup-failed' }
  }
}

import { createDeezerClient } from '@/core/clients/deezer'
import { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinClient } from '@/core/clients/jellyfin'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createPlexClient } from '@/core/clients/plex'
import { createSpotifyClient } from '@/core/clients/spotify'
import { createSubsonicClient } from '@/core/clients/subsonic'
import { resolveProviderToken } from '@/core/provider-auth'
import type { Database } from '@/db'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { getSettings } from '@/db/queries/settings'
import { getUserConnections } from '@/db/queries/users'
import type { TrackResolverDeps } from './types'

export async function buildPlaylistResolverDeps(
  db: Database,
  userId: number | null,
): Promise<TrackResolverDeps> {
  const mbClient = createMusicBrainzClient()
  const deezerClient = createDeezerClient()
  const deps: TrackResolverDeps = {
    musicbrainzRecordings: (artistMbid) => mbClient.getRecordings(artistMbid),
    deezerSearch: (query, limit = 10) => deezerClient.searchTracks(query, limit),
  }
  if (userId == null) return deps

  const [conns, settings] = await Promise.all([getUserConnections(db, userId), getSettings(db)])
  const skipTlsVerify = settings?.skipTlsVerify ?? false
  if (conns?.jellyfinUrl && conns.jellyfinApiKey && conns.jellyfinUserId) {
    const client = createJellyfinClient(
      conns.jellyfinUrl,
      conns.jellyfinApiKey,
      conns.jellyfinUserId,
      {
        libraryId: conns.jellyfinLibraryId,
        skipTlsVerify,
      },
    )
    deps.jellyfinSearch = (artist) => client.searchTracks(artist)
  }
  if (conns?.embyUrl && conns.embyApiKey && conns.embyUserId) {
    const client = createEmbyClient(conns.embyUrl, conns.embyApiKey, conns.embyUserId, {
      libraryId: conns.embyLibraryId,
      skipTlsVerify,
    })
    deps.embySearch = (artist) => client.searchTracks(artist)
  }
  if (conns?.subsonicUrl && conns.subsonicUsername && conns.subsonicPassword) {
    const client = createSubsonicClient(
      conns.subsonicUrl,
      conns.subsonicUsername,
      conns.subsonicPassword,
      { skipTlsVerify },
    )
    deps.navidromeSearch = (artist) => client.searchTracks(artist)
  }
  if (conns?.plexUrl && conns.plexToken) {
    const client = createPlexClient(conns.plexUrl, conns.plexToken, {
      sectionId: conns.plexSectionId,
    })
    deps.plexSearch = (artist) => client.searchTracks(artist)
  }

  if (await getOAuthToken(db, userId, 'spotify')) {
    deps.spotifySearch = async (query, limit = 10) => {
      const accessToken = await resolveProviderToken(db, userId, 'spotify')
      return createSpotifyClient(accessToken).searchTracks(query, limit)
    }
  }
  return deps
}

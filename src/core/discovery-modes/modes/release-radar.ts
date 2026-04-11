import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import { createSpotifySource } from '@/core/plugins/spotify'
import type { DiscoverySource, TopArtistEntry } from '@/core/plugins/types'
import type { DiscoveryModeDefinition } from '../types'
import {
  getDiscoveryModeConnections,
  getDiscoveryModeSpotifyToken,
  getProviderPath,
} from './runtime'

type SourceArtist = TopArtistEntry & { providerId: string }

function parseWindowDays(value: unknown): number {
  const days = Number(value)
  if (!Number.isFinite(days)) return 30
  return Math.min(Math.max(Math.trunc(days), 1), 365)
}

async function getReleaseRadarSources(
  userId: number,
): Promise<Array<{ id: string; source: Pick<DiscoverySource, 'getTopArtists'> }>> {
  const [connections, spotifyToken] = await Promise.all([
    getDiscoveryModeConnections(userId),
    getDiscoveryModeSpotifyToken(userId),
  ])
  const sources: Array<{ id: string; source: Pick<DiscoverySource, 'getTopArtists'> }> = []

  if (connections?.listenbrainzUsername && connections.listenbrainzToken) {
    sources.push({
      id: 'listenbrainz',
      source: createListenBrainzSource(
        connections.listenbrainzUsername,
        connections.listenbrainzToken,
      ),
    })
  }
  if (connections?.lastfmUsername && connections.lastfmApiKey) {
    sources.push({
      id: 'lastfm',
      source: createLastFmSource(connections.lastfmUsername, connections.lastfmApiKey),
    })
  }
  if (spotifyToken) {
    sources.push({
      id: 'spotify',
      source: createSpotifySource(spotifyToken),
    })
  }

  return sources
}

function deduplicateArtists(artists: SourceArtist[]): SourceArtist[] {
  const seen = new Map<string, SourceArtist>()
  for (const artist of artists) {
    const key = artist.mbid?.trim() || artist.name.trim().toLowerCase()
    const existing = seen.get(key)
    if (!existing || artist.playCount > existing.playCount) {
      seen.set(key, artist)
    }
  }
  return [...seen.values()]
}

export function createReleaseRadarMode(): DiscoveryModeDefinition {
  return {
    id: 'release-radar',
    label: 'Release Radar',
    description: 'Discover from new releases connected to your tracked artists',
    availability: 'strict',
    easyFields: [{ key: 'windowDays', label: 'Release window', type: 'number', required: true }],
    advancedFields: [
      { key: 'windowDays', label: 'Release window', type: 'number', required: true },
    ],
    executor: async (request) => {
      const availableSources = await getReleaseRadarSources(request.userId)
      if (availableSources.length === 0) {
        throw new Error('Connect ListenBrainz, Spotify, or Last.fm to use this mode.')
      }

      const providerPath = getProviderPath(request)
      const selectedSources =
        providerPath.length > 0
          ? availableSources.filter(({ id }) => providerPath.includes(id))
          : availableSources

      if (selectedSources.length === 0) {
        throw new Error('No supported release-radar providers are available.')
      }

      const topArtists = deduplicateArtists(
        (
          await Promise.all(
            selectedSources.map(async ({ id, source }) =>
              (
                await source.getTopArtists(10)
              )
                .filter((artist) => artist.mbid)
                .map((artist) => ({ ...artist, providerId: id })),
            ),
          )
        ).flat(),
      )
      const musicbrainz = createMusicBrainzClient()
      const windowDays = parseWindowDays(request.normalizedSettings.windowDays)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - windowDays)

      const candidates = []
      for (const artist of topArtists) {
        if (!artist.mbid) continue

        const releaseGroups = await musicbrainz.getReleaseGroups(artist.mbid)
        for (const release of releaseGroups) {
          if (!release.firstReleaseDate) continue

          const releaseDate = new Date(release.firstReleaseDate)
          if (Number.isNaN(releaseDate.getTime()) || releaseDate < cutoff) continue

          candidates.push({
            candidateType: 'release' as const,
            name: release.title,
            artistName: artist.name,
            artistMbid: artist.mbid,
            releaseGroupMbid: release.id,
            provenanceProvider: artist.providerId,
            fallbackUsed: artist.providerId !== 'listenbrainz',
            freshnessDate: release.firstReleaseDate,
          })
        }
      }

      return { candidates }
    },
  }
}

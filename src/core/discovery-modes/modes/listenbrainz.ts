import type { RadioMode } from '@/core/clients/listenbrainz'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createListenBrainzAdapter } from '@/core/subscriptions/adapters/listenbrainz'
import type {
  DiscoveryConfigField,
  DiscoveryModeDefinition,
  RawDiscoveryExecutionResult,
} from '../types'
import { getDiscoveryModeConnections, getNormalizedLimit, normalizeDiscoveryName } from './runtime'

function mapFeedArtists(
  artists: Array<{ name: string; similarityScore?: number; source: string }>,
  limit: number,
) {
  return artists.slice(0, limit).map((artist) => ({
    candidateType: 'artist' as const,
    name: artist.name,
    provenanceProvider: artist.source,
    confidenceHint: artist.similarityScore,
    fallbackUsed: false,
  }))
}

async function executeSimilarUsers(userId: number, limit: number) {
  const connections = await getDiscoveryModeConnections(userId)
  const username = connections?.listenbrainzUsername?.trim()
  const token = connections?.listenbrainzToken?.trim()
  if (!username || !token) {
    throw new Error('Connect ListenBrainz to use this mode.')
  }

  const client = createListenBrainzClient(username, token)
  const topArtists = (await client.getTopArtists('month'))
    .filter((artist) => artist.mbid)
    .slice(0, 5)

  const seedNames = new Set(topArtists.map((artist) => normalizeDiscoveryName(artist.name)))
  const seen = new Set<string>()
  const candidates: Array<{
    candidateType: 'artist'
    name: string
    provenanceProvider: string
    confidenceHint: number
    fallbackUsed: false
  }> = []

  for (const seed of topArtists) {
    if (!seed.mbid) continue

    const similarArtists = await client.getSimilarArtists(seed.mbid)
    for (const artist of similarArtists) {
      const normalized = normalizeDiscoveryName(artist.name)
      if (!normalized || seedNames.has(normalized) || seen.has(normalized)) continue

      seen.add(normalized)
      candidates.push({
        candidateType: 'artist',
        name: artist.name,
        provenanceProvider: 'listenbrainz:similar-users-quick',
        confidenceHint: artist.score,
        fallbackUsed: false,
      })

      if (candidates.length >= limit) {
        return { candidates }
      }
    }
  }

  return { candidates }
}

export function createListenBrainzMode(): DiscoveryModeDefinition {
  return {
    id: 'listenbrainz',
    label: 'ListenBrainz',
    description: 'Discover from ListenBrainz graph data and feeds',
    availability: 'strict',
    easyFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [{ value: 'weekly-jams', label: 'Weekly Jams' }],
      },
    ],
    advancedFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [
          { value: 'weekly-jams', label: 'Weekly Jams' },
          { value: 'similar-users-quick', label: 'Similar Users (Quick)' },
        ],
      },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async (request) => {
      const connections = await getDiscoveryModeConnections(request.userId)
      const username = connections?.listenbrainzUsername?.trim()
      const token = connections?.listenbrainzToken?.trim()
      if (!username || !token) {
        throw new Error('Connect ListenBrainz to use this mode.')
      }

      const feedType =
        request.normalizedSettings.feedType === 'similar-users-quick'
          ? 'similar-users-quick'
          : 'weekly-jams'
      const limit = getNormalizedLimit(request, 25)

      if (feedType === 'similar-users-quick') {
        return executeSimilarUsers(request.userId, limit)
      }

      const adapter = createListenBrainzAdapter({ username, token })
      const result = await adapter.fetch(
        { feedType },
        { limit: request.normalizedSettings.limit as number | undefined },
      )

      return {
        candidates: mapFeedArtists(result.artists, limit),
      }
    },
  }
}

async function getConnectedClient(userId: number) {
  const connections = await getDiscoveryModeConnections(userId)
  const username = connections?.listenbrainzUsername?.trim()
  const token = connections?.listenbrainzToken?.trim()
  if (!username || !token) {
    throw new Error('Connect ListenBrainz to use this mode.')
  }
  return { client: createListenBrainzClient(username, token), username }
}

function mapRadioArtists(
  artists: Array<{ name: string; mbid: string; score: number }>,
  provenance: string,
  limit: number,
): RawDiscoveryExecutionResult {
  return {
    candidates: artists.slice(0, limit).map((a) => ({
      candidateType: 'artist' as const,
      name: a.name,
      mbid: a.mbid,
      provenanceProvider: provenance,
      confidenceHint: a.score,
      fallbackUsed: false,
    })),
  }
}

export function createListenBrainzRadioModes(): DiscoveryModeDefinition[] {
  const adventurenessField: DiscoveryConfigField = {
    key: 'adventurousness',
    label: 'Adventurousness',
    type: 'select',
    options: [
      { value: 'easy', label: 'Safe' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Adventurous' },
    ],
  }

  const artistRadio: DiscoveryModeDefinition = {
    id: 'lb-artist-radio',
    label: 'Artist Radio',
    description: 'Discover artists similar to a seed artist via ListenBrainz radio',
    availability: 'strict',
    easyFields: [
      {
        key: 'seedArtistMbid',
        label: 'Artist',
        type: 'text',
        required: true,
        helpText: 'Artist name or MBID to seed the radio',
      },
      adventurenessField,
    ],
    advancedFields: [
      {
        key: 'seedArtistMbid',
        label: 'Artist',
        type: 'text',
        required: true,
        helpText: 'Artist name or MBID to seed the radio',
      },
      adventurenessField,
      { key: 'limit', label: 'Limit', type: 'number' },
    ],
    executor: async (request) => {
      const { client } = await getConnectedClient(request.userId)
      const mbid = String(request.normalizedSettings.seedArtistMbid)
      const mode = (request.normalizedSettings.adventurousness as RadioMode) ?? 'medium'
      const limit = getNormalizedLimit(request, 25)
      const artists = await client.getArtistRadio(mbid, mode)
      return mapRadioArtists(artists, 'listenbrainz:artist-radio', limit)
    },
  }

  const userRadio: DiscoveryModeDefinition = {
    id: 'lb-user-radio',
    label: 'User Radio',
    description: "Discover artists via radio seeded from a user's top listened artist",
    availability: 'strict',
    easyFields: [],
    advancedFields: [
      {
        key: 'targetUsername',
        label: 'Username',
        type: 'text',
        helpText: 'Leave blank to use your connected account',
      },
      adventurenessField,
      { key: 'limit', label: 'Limit', type: 'number' },
    ],
    executor: async (request) => {
      const { client, username } = await getConnectedClient(request.userId)
      const target = String(request.normalizedSettings.targetUsername || username)
      const mode = (request.normalizedSettings.adventurousness as RadioMode) ?? 'medium'
      const limit = getNormalizedLimit(request, 25)
      const artists = await client.getUserRadio(target, mode)
      return mapRadioArtists(artists, 'listenbrainz:user-radio', limit)
    },
  }

  const similarUsersDeep: DiscoveryModeDefinition = {
    id: 'similar-users-deep',
    label: 'Similar Users (Deep)',
    description: 'Discover from top artists of ListenBrainz users with similar taste',
    availability: 'strict',
    easyFields: [],
    advancedFields: [
      {
        key: 'maxUsers',
        label: 'Users to sample',
        type: 'number',
        helpText: 'How many similar users to pull top artists from (1-10)',
      },
      { key: 'limit', label: 'Limit', type: 'number' },
    ],
    executor: async (request) => {
      const { client } = await getConnectedClient(request.userId)
      const maxUsers = Math.min(Math.max(1, Number(request.normalizedSettings.maxUsers) || 3), 10)
      const limit = getNormalizedLimit(request, 25)

      const similarUsers = await client.getSimilarUsers()
      const topUsers = similarUsers.slice(0, maxUsers)

      const seen = new Set<string>()
      const candidates: RawDiscoveryExecutionResult['candidates'] = []

      for (const simUser of topUsers) {
        const topArtists = await client.getTopArtistsForUser(simUser.username, 'month')
        for (const artist of topArtists) {
          const normalized = normalizeDiscoveryName(artist.name)
          if (!normalized || seen.has(normalized)) continue
          seen.add(normalized)
          candidates.push({
            candidateType: 'artist',
            name: artist.name,
            mbid: artist.mbid,
            provenanceProvider: 'listenbrainz:similar-users-deep',
            confidenceHint: simUser.similarity * 0.8,
            fallbackUsed: false,
          })
          if (candidates.length >= limit) return { candidates }
        }
      }

      return { candidates }
    },
  }

  return [artistRadio, userRadio, similarUsersDeep]
}

import type { RadioMode, TagRadioInput } from '@/core/clients/listenbrainz'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { resolveTagRadioRecordings } from '@/core/clients/tag-radio-resolver'
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

function parseRawTagExpression(raw: string): TagRadioInput[] {
  const results: TagRadioInput[] = []
  for (const m of raw.matchAll(/\(([^)]+)\):(\d+)/g)) {
    if (m[1]) results.push({ tag: m[1], weight: Number(m[2]) })
  }
  if (results.length === 0) {
    return [{ tag: raw.trim(), weight: 1 }]
  }
  return results
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function resolveArtistSeedToMbid(seed: string): Promise<string> {
  const trimmed = seed.trim()
  if (!trimmed) {
    throw new Error('Artist seed is required.')
  }
  if (UUID_RE.test(trimmed)) {
    return trimmed
  }

  const searchResult = await createMusicBrainzClient().searchArtist(trimmed)
  const normalizedSeed = normalizeDiscoveryName(trimmed)
  const exactMatch = searchResult.artists.find(
    (artist) => normalizeDiscoveryName(artist.name) === normalizedSeed,
  )
  const singleResult = searchResult.artists.length === 1 ? searchResult.artists[0] : null
  const resolved = exactMatch ?? singleResult

  if (!resolved?.id) {
    throw new Error(`Could not resolve artist seed "${trimmed}" to a MusicBrainz artist.`)
  }

  return resolved.id
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
    prepare: async (request) => {
      const seedArtistMbid = await resolveArtistSeedToMbid(
        String(request.normalizedSettings.seedArtistMbid ?? ''),
      )

      return {
        ...request,
        normalizedSettings: {
          ...request.normalizedSettings,
          seedArtistMbid,
        },
      }
    },
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

export function createListenBrainzTagRadioMode(): DiscoveryModeDefinition {
  return {
    id: 'lb-tag-radio',
    label: 'Tag Radio',
    description: 'Discover artists matching genre tags via ListenBrainz radio',
    availability: 'strict',
    easyFields: [
      {
        key: 'tags',
        label: 'Tags',
        type: 'tags' as DiscoveryConfigField['type'],
        required: true,
        helpText: 'Genre or style tags to discover from. Add multiple tags with weights.',
      },
    ],
    advancedFields: [
      {
        key: 'tags',
        label: 'Tags',
        type: 'tags' as DiscoveryConfigField['type'],
        required: true,
        helpText: 'Genre or style tags to discover from. Add multiple tags with weights.',
      },
      {
        key: 'rawTagExpression',
        label: 'Raw tag expression',
        type: 'text',
        helpText: 'Override tag builder with raw LB syntax, e.g. (trip hop):2:(ambient):1',
      },
      {
        key: 'count',
        label: 'Recordings to fetch',
        type: 'number',
        helpText:
          'Default 25. Higher values improve diversity but are slower due to MusicBrainz rate limiting (~1 second per recording).',
      },
      {
        key: 'popBegin',
        label: 'Popularity min',
        type: 'number',
        helpText: '0-100. Filter out recordings below this popularity.',
      },
      {
        key: 'popEnd',
        label: 'Popularity max',
        type: 'number',
        helpText: '0-100. Filter out recordings above this popularity.',
      },
    ],
    executor: async (request) => {
      const { client } = await getConnectedClient(request.userId)
      const [{ db }, { createMusicBrainzClient }] = await Promise.all([
        import('@/db'),
        import('@/core/clients/musicbrainz'),
      ])
      const mbClient = createMusicBrainzClient()

      const rawExpr = String(request.normalizedSettings.rawTagExpression ?? '').trim()
      let tags: TagRadioInput[]
      if (rawExpr) {
        tags = parseRawTagExpression(rawExpr)
      } else {
        const tagsRaw = request.normalizedSettings.tags
        tags = Array.isArray(tagsRaw)
          ? (tagsRaw as Array<Record<string, unknown>>)
              .filter((t) => typeof t.tag === 'string' && t.tag.trim())
              .map((t) => ({ tag: String(t.tag).trim(), weight: Number(t.weight) || 1 }))
          : []
      }

      if (tags.length === 0) {
        throw new Error('At least one tag is required.')
      }

      const count = Number(request.normalizedSettings.count) || 25
      const popBegin = Number(request.normalizedSettings.popBegin) || 0
      const popEnd = Number(request.normalizedSettings.popEnd) || 100

      const recordings = await client.getTagRadio(tags, { count, popBegin, popEnd })
      const resolved = await resolveTagRadioRecordings(recordings, mbClient, db)

      const limit = getNormalizedLimit(request, 25)
      return {
        candidates: resolved.slice(0, limit).map((a) => ({
          candidateType: 'artist' as const,
          name: a.artistName,
          mbid: a.artistMbid,
          provenanceProvider: 'listenbrainz:tag-radio',
          confidenceHint: a.score,
          fallbackUsed: false,
        })),
      }
    },
  }
}

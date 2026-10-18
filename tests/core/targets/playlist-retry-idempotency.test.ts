// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedPlaylistExportStore } from '@/core/playlists/export'
import type { DestinationTarget } from '@/core/targets/types'

// Stateful fake servers apply a write and then lose its response, which is what a timeout
// after an accepted write looks like to Digarr. Every write position is exercised.

type Entry = { entry: string; id: string }
type RemotePlaylist = { id: string; name: string; foreign: boolean; tracks: Entry[] }
type Fake = {
  playlists: Map<string, RemotePlaylist>
  failAt: number | null
  mutations: number
  creates: number
  entrySeq: number
}

const LIBRARY = [
  {
    title: 'One',
    spotify: `spotify:track:${'A'.repeat(22)}`,
    plex: '11',
    subsonic: 'song-1',
    jellyfin: 'audio-1',
  },
  {
    title: 'Two',
    spotify: `spotify:track:${'B'.repeat(22)}`,
    plex: '12',
    subsonic: 'song-2',
    jellyfin: 'audio-2',
  },
]
const ARTIST = 'Artist'
const ITEMS = LIBRARY.map((track) => ({
  artistName: ARTIST,
  artistMbid: '',
  trackName: track.title,
  spotifyUri: track.spotify,
}))

const fakes: Record<string, Fake> = {}

function newFake(): Fake {
  return { playlists: new Map(), failAt: null, mutations: 0, creates: 0, entrySeq: 0 }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function mutate(fake: Fake, apply: () => Response): Response {
  const response = apply()
  const index = fake.mutations++
  if (fake.failAt === index) throw new DOMException('The operation timed out', 'TimeoutError')
  return response
}

function entries(fake: Fake, ids: string[]): Entry[] {
  return ids.map((id) => ({ entry: `entry-${++fake.entrySeq}`, id }))
}

function createRemote(fake: Fake, prefix: string, name: string, ids: string[]): RemotePlaylist {
  fake.creates += 1
  const playlist = {
    id: `${prefix}${fake.creates}`,
    name,
    foreign: false,
    tracks: entries(fake, ids),
  }
  fake.playlists.set(playlist.id, playlist)
  return playlist
}

function matchQuery(query: string | null, key: 'plex' | 'subsonic' | 'jellyfin') {
  return LIBRARY.filter((track) => query === `${ARTIST} ${track.title}`).map((track) => ({
    id: track[key],
    title: track.title,
  }))
}

function spotify(fake: Fake, url: URL, init: RequestInit): Response {
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(String(init.body)) : {}
  if (url.pathname === '/v1/me') return json({ id: 'sp-user' })
  if (url.pathname === '/v1/me/playlists' && method === 'POST') {
    return mutate(fake, () => {
      const playlist = createRemote(fake, 'sp', body.name, [])
      return json({ id: playlist.id, name: playlist.name })
    })
  }
  const match = /^\/v1\/playlists\/([^/]+)(\/items)?$/.exec(url.pathname)
  const playlist = match ? fake.playlists.get(decodeURIComponent(match[1] ?? '')) : undefined
  if (!match || !playlist) return json({ error: 'not found' }, 404)
  if (match[2]) {
    return mutate(fake, () => {
      const added = entries(fake, body.uris)
      playlist.tracks = method === 'PUT' ? added : [...playlist.tracks, ...added]
      return json({ snapshot_id: 'snapshot' })
    })
  }
  if (method === 'GET')
    return json({ id: playlist.id, owner: { id: playlist.foreign ? 'other' : 'sp-user' } })
  return mutate(fake, () => {
    playlist.name = body.name
    return new Response(null, { status: 200 })
  })
}

function plex(fake: Fake, url: URL, init: RequestInit): Response {
  const method = init.method ?? 'GET'
  const keys = () => url.searchParams.get('uri')?.split('/library/metadata/')[1]?.split(',') ?? []
  if (url.pathname === '/') return json({ MediaContainer: { machineIdentifier: 'machine-1' } })
  if (url.pathname === '/hubs/search') {
    const Metadata = matchQuery(url.searchParams.get('query'), 'plex').map((track) => ({
      ratingKey: track.id,
      title: track.title,
      grandparentTitle: ARTIST,
      type: 'track',
    }))
    return json({ MediaContainer: { Hub: [{ type: 'track', Metadata }] } })
  }
  if (url.pathname === '/playlists' && method === 'POST') {
    return mutate(fake, () => {
      const playlist = createRemote(fake, 'px', url.searchParams.get('title') ?? '', keys())
      return json({
        MediaContainer: { Metadata: [{ ratingKey: playlist.id, title: playlist.name }] },
      })
    })
  }
  const match = /^\/playlists\/([^/]+)(\/items)?$/.exec(url.pathname)
  const playlist = match ? fake.playlists.get(match[1] ?? '') : undefined
  if (!match || !playlist) return new Response('not found', { status: 404 })
  if (!match[2]) {
    return json({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: playlist.id,
            type: 'playlist',
            playlistType: 'audio',
            smart: playlist.foreign ? 1 : 0,
            title: playlist.name,
          },
        ],
      },
    })
  }
  return mutate(fake, () => {
    playlist.tracks = method === 'DELETE' ? [] : [...playlist.tracks, ...entries(fake, keys())]
    return new Response('', { status: 200 })
  })
}

function subsonic(fake: Fake, url: URL): Response {
  const ok = (body: Record<string, unknown>) =>
    json({ 'subsonic-response': { status: 'ok', ...body } })
  const missing = () =>
    json({ 'subsonic-response': { status: 'failed', error: { code: 70, message: 'Not found' } } })
  const params = url.searchParams
  const endpoint = url.pathname.replace('/rest/', '')
  if (endpoint === 'getUser') return ok({ user: { username: params.get('username') } })
  if (endpoint === 'search3') {
    const song = matchQuery(params.get('query'), 'subsonic').map((track) => ({
      ...track,
      artist: ARTIST,
    }))
    return ok({ searchResult3: { song } })
  }
  const existing = fake.playlists.get(params.get('playlistId') ?? params.get('id') ?? '')
  if (endpoint === 'getPlaylist') {
    return existing
      ? ok({ playlist: { id: existing.id, owner: existing.foreign ? 'other' : 'user' } })
      : missing()
  }
  if (endpoint === 'createPlaylist') {
    if (params.has('playlistId') && !existing) return missing()
    return mutate(fake, () => {
      const songs = params.getAll('songId')
      if (existing) existing.tracks = entries(fake, songs)
      const playlist = existing ?? createRemote(fake, 'nd', params.get('name') ?? '', songs)
      return ok({ playlist: { id: playlist.id } })
    })
  }
  if (endpoint === 'updatePlaylist') {
    if (!existing) return missing()
    return mutate(fake, () => {
      existing.tracks.push(...entries(fake, params.getAll('songIdToAdd')))
      existing.name = params.get('name') ?? existing.name
      return ok({})
    })
  }
  return missing()
}

function jellyfin(fake: Fake, url: URL, init: RequestInit): Response {
  const method = init.method ?? 'GET'
  const params = url.searchParams
  if (url.pathname === '/System/Info') return json({ Id: 'server-1' })
  if (url.pathname === '/Users/user-1') return json({ Id: 'user-1' })
  if (url.pathname === '/Users/user-1/Items') {
    const Items = matchQuery(params.get('searchTerm'), 'jellyfin').map((track) => ({
      Id: track.id,
      Name: track.title,
      AlbumArtist: ARTIST,
    }))
    return json({ Items })
  }
  if (url.pathname === '/Playlists' && method === 'POST') {
    return mutate(fake, () => {
      const body = JSON.parse(String(init.body))
      return json({ Id: createRemote(fake, 'jf', body.Name, body.Ids).id })
    })
  }
  const item = /^\/Users\/user-1\/Items\/([^/]+)$/.exec(url.pathname)
  const listed = /^\/Playlists\/([^/]+)\/Items$/.exec(url.pathname)
  const playlist = fake.playlists.get((item ?? listed)?.[1] ?? '')
  if (!playlist) return new Response('not found', { status: 404 })
  if (item) {
    return json({
      Id: playlist.id,
      Type: 'Playlist',
      MediaType: playlist.foreign ? 'Video' : 'Audio',
      Name: playlist.name,
    })
  }
  if (method === 'GET') {
    const start = Number(params.get('StartIndex'))
    const page = playlist.tracks.slice(start, start + Number(params.get('Limit')))
    return json({
      Items: page.map((track) => ({ PlaylistItemId: track.entry })),
      TotalRecordCount: playlist.tracks.length,
    })
  }
  return mutate(fake, () => {
    if (method === 'POST') {
      playlist.tracks.push(...entries(fake, params.get('Ids')?.split(',') ?? []))
    } else {
      const removed = new Set(params.get('EntryIds')?.split(','))
      playlist.tracks = playlist.tracks.filter((track) => !removed.has(track.entry))
    }
    return new Response('', { status: 200 })
  })
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (url.host === 'api.spotify.com') return spotify(fakes.spotify as Fake, url, init)
    if (url.host === 'plex:32400') return plex(fakes.plex as Fake, url, init)
    if (url.host === 'navidrome:4533') return subsonic(fakes.navidrome as Fake, url)
    if (url.host === 'jellyfin:8096') return jellyfin(fakes.jellyfin as Fake, url, init)
    if (url.host === 'emby:8096') return jellyfin(fakes.emby as Fake, url, init)
    throw new Error(`Unexpected request ${url}`)
  }),
)

const { pushSavedPlaylistToTargets } = await import('@/core/playlists/export')
const { createSpotifyPlaylistTarget } = await import('@/core/targets/spotify-playlist')
const { createPlexPlaylistTarget } = await import('@/core/targets/plex-playlist')
const { createNavidromePlaylistTarget } = await import('@/core/targets/navidrome-playlist')
const { createJellyfinPlaylistTarget } = await import('@/core/targets/jellyfin-playlist')
const { createEmbyPlaylistTarget } = await import('@/core/targets/emby-playlist')

type Flavor = {
  name: string
  type: string
  make: (targetId: number) => DestinationTarget
  expected: string[]
}

const FLAVORS: Flavor[] = [
  {
    name: 'spotify',
    type: 'spotify-playlist',
    make: (id) => createSpotifyPlaylistTarget(id, { getAccessToken: async () => 'sp-token' }),
    expected: LIBRARY.map((track) => track.spotify),
  },
  {
    name: 'plex',
    type: 'plex-playlist',
    make: (id) => createPlexPlaylistTarget(id, { url: 'http://plex:32400', token: 'plex-token' }),
    expected: LIBRARY.map((track) => track.plex),
  },
  {
    name: 'navidrome',
    type: 'navidrome-playlist',
    make: (id) =>
      createNavidromePlaylistTarget(id, {
        url: 'http://navidrome:4533',
        username: 'user',
        password: 'pw',
      }),
    expected: LIBRARY.map((track) => track.subsonic),
  },
  {
    name: 'jellyfin',
    type: 'jellyfin-playlist',
    make: (id) =>
      createJellyfinPlaylistTarget(id, {
        url: 'http://jellyfin:8096',
        apiKey: 'jf-key',
        userId: 'user-1',
      }),
    expected: LIBRARY.map((track) => track.jellyfin),
  },
  {
    name: 'emby',
    type: 'emby-playlist',
    make: (id) =>
      createEmbyPlaylistTarget(id, {
        url: 'http://emby:8096',
        apiKey: 'emby-key',
        userId: 'user-1',
      }),
    expected: LIBRARY.map((track) => track.jellyfin),
  },
]

type Binding = Awaited<ReturnType<SavedPlaylistExportStore['reserve']>>['binding']

function memoryStore() {
  const rows = new Map<number, Binding>()
  const store: SavedPlaylistExportStore = {
    async reserve(targetId, scope) {
      const existing = rows.get(targetId)
      if (existing) return { created: false, binding: { ...existing } }
      const binding: Binding = { remoteScope: scope, remotePlaylistId: null, state: 'creating' }
      rows.set(targetId, binding)
      return { created: true, binding: { ...binding } }
    },
    async link(targetId, scope, remotePlaylistId) {
      const binding = rows.get(targetId)
      if (!binding || binding.remoteScope !== scope || binding.state !== 'creating')
        throw new Error('Playlist export checkpoint was not persisted')
      rows.set(targetId, { ...binding, remotePlaylistId, state: 'linked' })
    },
    async markRecoveryRequired(targetId) {
      const binding = rows.get(targetId)
      if (binding?.state === 'creating')
        rows.set(targetId, { ...binding, state: 'recovery_required' })
    },
  }
  return { rows, store }
}

async function exportTo(flavors: Flavor[], store: SavedPlaylistExportStore): Promise<Error | null> {
  const targets = flavors.map((flavor, index) => ({
    targetId: index + 1,
    target: flavor.make(index + 1),
  }))
  try {
    await pushSavedPlaylistToTargets(targets, 'Mix', ITEMS, store)
    return null
  } catch (error) {
    return error as Error
  }
}

function contents(fake: Fake): string[][] {
  return [...fake.playlists.values()].map((playlist) => playlist.tracks.map((track) => track.id))
}

beforeEach(() => {
  for (const flavor of FLAVORS) fakes[flavor.name] = newFake()
})

describe.each(FLAVORS)('$name export retry after a lost write response', (flavor) => {
  const fake = () => fakes[flavor.name] as Fake

  it('never creates a second playlist or duplicates tracks when a first-export write times out', async () => {
    for (let failAt = 0; failAt < 10; failAt++) {
      fakes[flavor.name] = newFake()
      const { rows, store } = memoryStore()
      fake().failAt = failAt
      const error = await exportTo([flavor], store)
      if (fake().mutations <= failAt) {
        expect(error).toBeNull()
        expect(failAt).toBeGreaterThan(0)
        return
      }
      expect(error?.message).toContain(`${flavor.type}(1)`)
      fake().failAt = null
      const retry = await exportTo([flavor], store)
      expect(fake().creates).toBe(1)
      if (failAt === 0) {
        // The create response never arrived, so there is no ID to reuse; never guess one.
        expect(retry?.message).toContain('unresolved')
        expect(rows.get(1)?.state).toBe('recovery_required')
      } else {
        expect(retry).toBeNull()
        expect(contents(fake())).toEqual([flavor.expected])
      }
    }
    throw new Error('write positions were not exhausted')
  })

  it('replaces the bound playlist exactly when any refresh write times out', async () => {
    for (let failAt = 0; failAt < 10; failAt++) {
      fakes[flavor.name] = newFake()
      const { store } = memoryStore()
      expect(await exportTo([flavor], store)).toBeNull()
      const base = fake().mutations
      fake().failAt = base + failAt
      const error = await exportTo([flavor], store)
      if (fake().mutations <= base + failAt) {
        expect(error).toBeNull()
        expect(failAt).toBeGreaterThan(0)
        return
      }
      expect(error).not.toBeNull()
      fake().failAt = null
      expect(await exportTo([flavor], store)).toBeNull()
      expect(fake().creates).toBe(1)
      expect(contents(fake())).toEqual([flavor.expected])
    }
    throw new Error('write positions were not exhausted')
  })

  it.each(['deleted', 'rotated', 'foreign'] as const)(
    'neither writes nor recreates when the bound playlist is %s',
    async (change) => {
      const { rows, store } = memoryStore()
      expect(await exportTo([flavor], store)).toBeNull()
      const bound = rows.get(1)?.remotePlaylistId as string
      const playlist = fake().playlists.get(bound) as RemotePlaylist
      if (change === 'foreign') playlist.foreign = true
      else fake().playlists.delete(bound)
      if (change === 'rotated')
        fake().playlists.set(`${bound}-new`, { ...playlist, id: `${bound}-new` })
      const before = fake().mutations

      expect(await exportTo([flavor], store)).not.toBeNull()
      expect(fake().mutations).toBe(before)
      expect(fake().creates).toBe(1)
      expect(rows.get(1)).toMatchObject({ state: 'linked', remotePlaylistId: bound })
    },
  )
})

describe('multi-target export retry', () => {
  it('keeps successful targets exact and repairs only the targets whose writes timed out', async () => {
    const { store } = memoryStore()
    expect(await exportTo(FLAVORS, store)).toBeNull()
    for (const name of ['spotify', 'jellyfin']) {
      const fake = fakes[name] as Fake
      fake.failAt = fake.mutations
    }

    const error = await exportTo(FLAVORS, store)
    expect(error?.message).toContain('spotify-playlist(1)')
    expect(error?.message).toContain('jellyfin-playlist(4)')
    for (const [index, flavor] of FLAVORS.entries()) {
      if (index === 0 || index === 3) continue
      expect(error?.message).not.toContain(`${flavor.type}(${index + 1})`)
      expect(contents(fakes[flavor.name] as Fake)).toEqual([flavor.expected])
    }

    for (const name of ['spotify', 'jellyfin']) (fakes[name] as Fake).failAt = null
    expect(await exportTo(FLAVORS, store)).toBeNull()
    for (const flavor of FLAVORS) {
      const fake = fakes[flavor.name] as Fake
      expect(fake.creates).toBe(1)
      expect(contents(fake)).toEqual([flavor.expected])
    }
  })
})

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinClient } from '@/core/clients/jellyfin'

// Emby and Jellyfin share the MediaBrowser API, so library scoping must produce the
// same requests for both. Protocol-specific behavior stays in emby.test.ts and
// jellyfin.test.ts.

const queueMocks = vi.hoisted(() => {
  const add = vi.fn((task: () => unknown) => task())
  return { add, create: vi.fn(() => ({ add })) }
})

vi.mock('@/core/clients/media-server-queue', () => ({
  createMediaServerQueue: queueMocks.create,
}))

type ClientOptions = { libraryId?: string }
type MediaServerClient = ReturnType<typeof createEmbyClient> &
  ReturnType<typeof createJellyfinClient>

type Flavor = {
  name: string
  userId: string
  create: (options?: ClientOptions) => MediaServerClient
}

const USER = '00000000-0000-0000-0000-000000000001'

const flavors: Flavor[] = [
  {
    name: 'emby',
    userId: USER,
    create: (options) =>
      createEmbyClient('http://media:8096', 'key', USER, options) as MediaServerClient,
  },
  {
    name: 'jellyfin',
    userId: USER,
    create: (options) =>
      createJellyfinClient('http://media:8096', 'key', USER, options) as MediaServerClient,
  },
]

const VIEWS = {
  Items: [
    { Id: 'lib-music', Name: 'Music', CollectionType: 'music' },
    { Id: 'lib-books', Name: 'Audiobooks', CollectionType: 'books' },
    { Id: 'lib-music-2', Name: 'Lossless', CollectionType: 'music' },
  ],
}

function respondWith(...bodies: unknown[]) {
  const fetchMock = vi.fn()
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    })
  }
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ Items: [], TotalRecordCount: 0 }),
  })
  vi.stubGlobal('fetch', fetchMock)
}

function requestUrl(index: number): string {
  return vi.mocked(fetch).mock.calls[index]?.[0] as string
}

beforeEach(() => {
  vi.restoreAllMocks()
  queueMocks.add.mockClear()
  queueMocks.create.mockClear()
})

describe.each(flavors)('$name library selection', ({ create, userId }) => {
  it('getMusicLibraries() returns only music-type views', async () => {
    respondWith(VIEWS)

    await expect(create().getMusicLibraries()).resolves.toEqual([
      { id: 'lib-music', name: 'Music' },
      { id: 'lib-music-2', name: 'Lossless' },
    ])
    expect(requestUrl(0)).toContain(`/Users/${userId}/Views`)
  })

  it('getTopArtists() uses the /Artists endpoint scoped by ParentId when a library is configured', async () => {
    respondWith({
      Items: [
        {
          Id: 'a1',
          Name: 'Aphex Twin',
          Genres: ['Electronic'],
          ProviderIds: { MusicBrainzArtist: 'f229e6d8-c66f-4e9f-a972-a7b6a1f47f49' },
          UserData: { PlayCount: 3 },
        },
      ],
      TotalRecordCount: 1,
    })

    await expect(create({ libraryId: 'lib-music-2' }).getTopArtists(10)).resolves.toEqual([
      {
        id: 'a1',
        name: 'Aphex Twin',
        mbid: 'f229e6d8-c66f-4e9f-a972-a7b6a1f47f49',
        genres: ['Electronic'],
        playCount: 3,
        isFavorite: false,
      },
    ])
    const url = requestUrl(0)
    expect(url).toContain('/Artists?')
    expect(url).toContain('ParentId=lib-music-2')
    expect(url).toContain(`UserId=${userId}`)
    expect(url).toContain('Fields=UserData%2CGenres%2CProviderIds')
  })

  it('getTopArtists() keeps the unscoped Items query when no library is configured', async () => {
    respondWith({ Items: [], TotalRecordCount: 0 })

    await create().getTopArtists(10)
    const url = requestUrl(0)
    expect(url).toContain(`/Users/${userId}/Items?`)
    expect(url).toContain('IncludeItemTypes=MusicArtist')
    expect(url).not.toContain('ParentId=')
  })

  it('getAllArtists() scopes through the /Artists endpoint when a library is configured', async () => {
    respondWith({ Items: [], TotalRecordCount: 0 })

    await create({ libraryId: 'lib-music-2' }).getAllArtists()
    const url = requestUrl(0)
    expect(url).toContain('/Artists?')
    expect(url).toContain('ParentId=lib-music-2')
    expect(url).toContain('Fields=Genres%2CProviderIds')
  })

  it('getFavoriteArtists() scopes through the /Artists endpoint when a library is configured', async () => {
    respondWith({ Items: [], TotalRecordCount: 0 })

    await create({ libraryId: 'lib-music-2' }).getFavoriteArtists(10)
    const url = requestUrl(0)
    expect(url).toContain('/Artists?')
    expect(url).toContain('ParentId=lib-music-2')
    expect(url).toContain('IsFavorite=true')
  })

  it('getRecentlyPlayed() scopes the Audio query with ParentId when a library is configured', async () => {
    respondWith({ Items: [], TotalRecordCount: 0 })

    await create({ libraryId: 'lib-music' }).getRecentlyPlayed(10)
    const url = requestUrl(0)
    expect(url).toContain(`/Users/${userId}/Items?`)
    expect(url).toContain('ParentId=lib-music')
  })

  it('testConnection() fails when the configured library no longer exists', async () => {
    respondWith({ ServerName: 'Home Media', Version: '10.9.0' }, VIEWS)

    const result = await create({ libraryId: 'lib-gone' }).testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('lib-gone')
    expect(result.message).toContain('Music (lib-music)')
    expect(result.message).toContain('Lossless (lib-music-2)')
  })
})

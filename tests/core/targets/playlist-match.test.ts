// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbyPlaylistTarget } from '@/core/targets/emby-playlist'
import { createJellyfinPlaylistTarget } from '@/core/targets/jellyfin-playlist'
import { createNavidromePlaylistTarget } from '@/core/targets/navidrome-playlist'
import { pickBestTrackMatch } from '@/core/targets/playlist-match'
import { createPlexPlaylistTarget } from '@/core/targets/plex-playlist'
import type { PlaylistItem } from '@/core/targets/types'

afterEach(() => vi.unstubAllGlobals())

describe('exact playlist track matching', () => {
  it.each([
    ['Radiohead', 'Creep', 'Radiohead', 'Creep', 'exact'],
    ['  MASSIVE\tATTACK ', ' TEARdrop  ', 'Massive Attack', 'Teardrop', 'exact'],
    ['Radiohead', 'Creep', 'Radiohead', 'Creep (Live)', null],
    ['Radiohead', 'Creep', 'Radiohead', 'Creep (Remastered)', null],
    ['Radiohead', 'Creep', 'Another Artist', 'Creep', null],
    ['Radiohead', 'Creep', 'Radiohead feat. Guest', 'Creep', null],
    ['   ', 'Creep', '', 'Creep', null],
    ['Radiohead', '\t', 'Radiohead', '', null],
  ])(
    'matches only normalized artist/title: %s / %s',
    (artist, title, credit, candidateTitle, id) => {
      expect(
        pickBestTrackMatch(
          [{ id: 'exact', title: candidateTitle, artists: ['Guest', credit] }],
          artist,
          title,
        ),
      ).toBe(id)
    },
  )

  const targets = [
    createNavidromePlaylistTarget(1, {
      url: 'http://navidrome:4533',
      username: 'admin',
      password: 'secret',
    }),
    createJellyfinPlaylistTarget(2, {
      url: 'http://jellyfin:8096',
      apiKey: 'key',
      userId: 'user-1',
    }),
    createEmbyPlaylistTarget(3, {
      url: 'http://emby:8096',
      apiKey: 'key',
      userId: 'user-1',
    }),
    createPlexPlaylistTarget(4, { url: 'http://plex:32400', token: 'token' }),
  ]

  it.each(targets.flatMap((target) => [true, false].map((partial) => ({ target, partial }))))(
    '$target.type exports exact IDs and accounts for omissions (partial=$partial)',
    async ({ target, partial }) => {
      const addedIds: string[] = []
      const searchQueries: string[] = []
      let created = 0
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const parsed = new URL(String(url))
        const query = parsed.searchParams.get('query') ?? parsed.searchParams.get('searchTerm')
        if (query) searchQueries.push(query)
        const candidates = [
          { id: 'wrong-title', title: 'Teardrop (Live)', artist: 'Massive Attack' },
          { id: 'wrong-artist', title: 'Teardrop', artist: 'Guest' },
          ...(query?.trim().endsWith('TEARdrop')
            ? [{ id: 'exact', title: '  Teardrop ', artist: ' MASSIVE\tATTACK ' }]
            : []),
        ]
        let body: unknown
        if (parsed.pathname === '/rest/getUser') {
          body = { user: { username: 'admin' } }
        } else if (parsed.pathname === '/System/Info') {
          body = { Id: 'server-1' }
        } else if (parsed.pathname === '/Users/user-1') {
          body = { Id: 'user-1' }
        } else if (parsed.pathname === '/rest/search3') {
          body = { searchResult3: { song: candidates } }
        } else if (parsed.pathname.endsWith('/Items')) {
          body = {
            Items: candidates.map((item) => ({
              Id: item.id,
              Name: item.title,
              Artists: ['Another Credit', item.artist],
            })),
          }
        } else if (parsed.pathname === '/hubs/search') {
          body = {
            MediaContainer: {
              Hub: [
                {
                  type: 'track',
                  Metadata: candidates.map((item) => ({
                    ratingKey: item.id,
                    title: item.title,
                    grandparentTitle: item.artist,
                    type: 'track',
                  })),
                },
              ],
            },
          }
        } else if (parsed.pathname === '/rest/createPlaylist') {
          created += 1
          body = { playlist: { id: 'playlist-1' } }
        } else if (parsed.pathname === '/rest/updatePlaylist') {
          addedIds.push(
            ...[...parsed.searchParams]
              .filter(([key]) => key.startsWith('songIdToAdd'))
              .map(([, id]) => id),
          )
          body = {}
        } else if (parsed.pathname === '/Playlists') {
          created += 1
          addedIds.push(...(JSON.parse(init?.body as string) as { Ids: string[] }).Ids)
          body = { Id: 'playlist-1' }
        } else if (parsed.pathname === '/playlists') {
          created += 1
          addedIds.push(
            ...(parsed.searchParams.get('uri')?.split('/metadata/')[1]?.split(',') ?? []),
          )
          body = { MediaContainer: { Metadata: [{ ratingKey: 'playlist-1', title: 'Picks' }] } }
        } else {
          body = { MediaContainer: { machineIdentifier: 'machine-1' } }
        }
        return new Response(
          JSON.stringify(
            target.type === 'navidrome-playlist'
              ? { 'subsonic-response': { status: 'ok', ...(body as object) } }
              : body,
          ),
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const items: PlaylistItem[] = [
        { artistName: 'Massive Attack', artistMbid: 'mbid-1', trackName: 'Teardrop (Remastered)' },
        { artistName: 'Other Artist', artistMbid: 'mbid-2', trackName: 'Teardrop' },
        { artistName: 'Massive Attack', artistMbid: 'mbid-1' },
        { artistName: 'Massive Attack', artistMbid: 'mbid-1', trackName: '  \t ' },
      ]
      if (partial)
        items.unshift({
          artistName: ' MASSIVE  ATTACK ',
          artistMbid: 'mbid-1',
          trackName: ' TEARdrop ',
        })
      const opening = target.openPlaylistExportSession?.(items)
      if (!partial) {
        await expect(opening).rejects.toThrow()
        expect(created).toBe(0)
      } else {
        const session = await opening
        expect(await session?.createPlaylist('Picks', async () => {})).toMatchObject({
          success: true,
          itemsAdded: 1,
          itemsSkipped: 4,
        })
        expect(created).toBe(1)
      }
      expect(addedIds).toEqual(partial ? ['exact'] : [])
      expect(searchQueries).toHaveLength(partial ? 3 : 2)
    },
  )
})

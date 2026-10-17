import { describe, expect, it } from 'vitest'
import type { MBReleaseGroup } from '@/core/clients/musicbrainz'
import { MusicBrainzHttpError } from '@/core/clients/musicbrainz'
import { createAlbumCoverageService } from '@/core/library/album-coverage'

const ARTIST_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const OWNED_RELEASE_GROUP_MBID = '11111111-1111-1111-1111-111111111111'
const MISSING_RELEASE_GROUP_MBID = '22222222-2222-2222-2222-222222222222'

describe('createAlbumCoverageService', () => {
  it('returns owned and missing studio albums from MB release groups', async () => {
    const service = createAlbumCoverageService({
      store: {
        listOwnedAlbumsForArtist: async () => [
          {
            source: 'plex',
            sourceAlbumId: 'live-album',
            albumMbid: 'live-album',
            title: 'Live album',
            releaseYear: 1995,
            primaryType: 'Album',
          },
          {
            source: 'plex',
            sourceAlbumId: 'album-1',
            albumMbid: OWNED_RELEASE_GROUP_MBID,
            title: 'Dummy',
            releaseYear: 1991,
            primaryType: 'Album',
          },
        ],
      },
      mbClient: {
        getReleaseGroups: async () => [
          {
            id: OWNED_RELEASE_GROUP_MBID,
            title: 'Dummy',
            type: 'Album',
            secondaryTypes: [],
            firstReleaseDate: '1991-01-01',
          },
          {
            id: MISSING_RELEASE_GROUP_MBID,
            title: 'Hex',
            type: 'Album',
            secondaryTypes: [],
            firstReleaseDate: '1994-02-14',
          },
          ...['Live', 'Compilation', 'Soundtrack', 'Demo', 'Remix'].map((secondaryType) => ({
            id: `${secondaryType.toLowerCase()}-album`,
            title: `${secondaryType} album`,
            type: 'Album',
            secondaryTypes: [secondaryType],
          })),
          {
            id: 'multiple-types',
            title: 'Live compilation',
            type: 'Album',
            secondaryTypes: ['Live', 'Compilation'],
          },
          {
            id: '33333333-3333-3333-3333-333333333333',
            title: 'Bonus EP',
            type: 'EP',
            secondaryTypes: [],
            firstReleaseDate: '1992-08-01',
          },
        ],
      },
    })

    const result = await service.getCoverageForArtist(7, ARTIST_MBID)

    expect(result.artistMbid).toBe(ARTIST_MBID)
    expect(result.ownedCount).toBe(1)
    expect(result.totalCount).toBe(2)
    expect(result.owned).toEqual([
      {
        albumMbid: OWNED_RELEASE_GROUP_MBID,
        title: 'Dummy',
        releaseYear: 1991,
      },
    ])
    expect(result.missing).toEqual([
      {
        albumMbid: MISSING_RELEASE_GROUP_MBID,
        title: 'Hex',
        releaseYear: 1994,
      },
    ])
  })

  it.each(
    [undefined, null, 'Live', {}, [null], [42], ['Live', null]].map((secondaryTypes) => ({
      secondaryTypes,
    })),
  )(
    'rejects unknown or malformed Album secondary types: $secondaryTypes',
    async ({ secondaryTypes }) => {
      const service = createAlbumCoverageService({
        store: { listOwnedAlbumsForArtist: async () => [] },
        mbClient: {
          getReleaseGroups: async () => [
            {
              id: MISSING_RELEASE_GROUP_MBID,
              title: 'Unclassified album',
              type: 'Album',
              secondaryTypes,
            } as unknown as MBReleaseGroup,
          ],
        },
      })

      await expect(service.getCoverageForArtist(7, ARTIST_MBID)).rejects.toThrow(
        /MusicBrainz.*secondary types/,
      )
    },
  )

  it('returns zero coverage when artist has no studio albums in MusicBrainz', async () => {
    const service = createAlbumCoverageService({
      store: {
        listOwnedAlbumsForArtist: async () => [],
      },
      mbClient: {
        getReleaseGroups: async () => [
          {
            id: '33333333-3333-3333-3333-333333333333',
            title: 'Bonus EP',
            type: 'EP',
            firstReleaseDate: '1992-08-01',
          },
        ],
      },
    })

    const result = await service.getCoverageForArtist(7, ARTIST_MBID)

    expect(result.artistMbid).toBe(ARTIST_MBID)
    expect(result.ownedCount).toBe(0)
    expect(result.totalCount).toBe(0)
    expect(result.owned).toEqual([])
    expect(result.missing).toEqual([])
  })

  it.each([
    { status: 404, empty: true },
    { status: 503, empty: false },
  ])('MusicBrainz $status: empty coverage=$empty', async ({ status, empty }) => {
    const service = createAlbumCoverageService({
      store: { listOwnedAlbumsForArtist: async () => [] },
      mbClient: {
        getReleaseGroups: async () => {
          throw new MusicBrainzHttpError(status, '/release-group')
        },
      },
    })
    const result = service.getCoverageForArtist(1, ARTIST_MBID)
    if (empty) {
      await expect(result).resolves.toEqual({
        artistMbid: ARTIST_MBID,
        ownedCount: 0,
        totalCount: 0,
        owned: [],
        missing: [],
      })
    } else {
      await expect(result).rejects.toThrow(/503/)
    }
  })
})

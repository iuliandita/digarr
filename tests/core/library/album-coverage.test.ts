import { describe, expect, it } from 'vitest'
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
            firstReleaseDate: '1991-01-01',
          },
          {
            id: MISSING_RELEASE_GROUP_MBID,
            title: 'Hex',
            type: 'Album',
            firstReleaseDate: '1994-02-14',
          },
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
})

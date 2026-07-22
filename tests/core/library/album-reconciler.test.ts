// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { reconcileAlbumsForArtist } from '@/core/library/album-reconciler'
import type { LibraryAlbum } from '@/core/library/sources/types'

const ARTIST_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const ALBUM_MBID = '11111111-1111-1111-1111-111111111111'
const ALBUM_MBID_2 = '22222222-2222-2222-2222-222222222222'

function album(overrides: Partial<LibraryAlbum> = {}): LibraryAlbum {
  return {
    sourceAlbumId: 'src-1',
    sourceArtistId: 'artist-1',
    title: 'In Rainbows',
    ...overrides,
  }
}

describe('reconcileAlbumsForArtist', () => {
  it('trusts a valid source MBID when it exists in the artist release groups', async () => {
    const mbClient = {
      getReleaseGroups: vi
        .fn()
        .mockResolvedValue([
          { id: ALBUM_MBID, title: 'In Rainbows', type: 'Album', firstReleaseDate: '2007-10-10' },
        ]),
    }

    const rows = await reconcileAlbumsForArtist(ARTIST_MBID, [album({ mbid: ALBUM_MBID })], {
      mbClient,
    })

    expect(rows[0]).toMatchObject({
      albumMbid: ALBUM_MBID,
      artistMbid: ARTIST_MBID,
      matchMethod: 'mbid',
      matchConfidence: 1,
      titleNormalized: 'in rainbows',
      unreconciledReason: null,
    })
  })

  it('matches by exact normalized title when there is a single candidate', async () => {
    const mbClient = {
      getReleaseGroups: vi
        .fn()
        .mockResolvedValue([
          { id: ALBUM_MBID, title: 'In Rainbows', type: 'Album', firstReleaseDate: '2007-10-10' },
        ]),
    }

    const rows = await reconcileAlbumsForArtist(ARTIST_MBID, [album()], { mbClient })

    expect(rows[0]).toMatchObject({
      albumMbid: ALBUM_MBID,
      matchMethod: 'title_exact',
      matchConfidence: 0.8,
      releaseYear: 2007,
      primaryType: 'Album',
      unreconciledReason: null,
    })
  })

  it('uses release year to break ties between duplicate normalized titles', async () => {
    const mbClient = {
      getReleaseGroups: vi.fn().mockResolvedValue([
        { id: ALBUM_MBID, title: 'Dummy', type: 'Album', firstReleaseDate: '1991-01-01' },
        { id: ALBUM_MBID_2, title: 'Dummy', type: 'Album', firstReleaseDate: '2021-01-01' },
      ]),
    }

    const rows = await reconcileAlbumsForArtist(
      ARTIST_MBID,
      [album({ title: 'Dummy', releaseYear: 2021 })],
      { mbClient },
    )

    expect(rows[0]).toMatchObject({
      albumMbid: ALBUM_MBID_2,
      matchMethod: 'title_year',
      matchConfidence: 0.7,
      releaseYear: 2021,
      unreconciledReason: null,
    })
  })

  it('classifies a successful lookup with no title candidates as no_candidate', async () => {
    const mbClient = {
      getReleaseGroups: vi.fn().mockResolvedValue([]),
    }

    const rows = await reconcileAlbumsForArtist(ARTIST_MBID, [album({ title: 'Missing' })], {
      mbClient,
    })

    expect(rows[0]).toMatchObject({
      albumMbid: null,
      matchMethod: null,
      matchConfidence: null,
      titleNormalized: 'missing',
      unreconciledReason: 'no_candidate',
    })
  })

  it('leaves the row unreconciled when multiple candidates match the same release year', async () => {
    const mbClient = {
      getReleaseGroups: vi.fn().mockResolvedValue([
        { id: ALBUM_MBID, title: 'Dummy', type: 'Album', firstReleaseDate: '2021-01-01' },
        { id: ALBUM_MBID_2, title: 'Dummy', type: 'Album', firstReleaseDate: '2021-01-01' },
      ]),
    }

    const rows = await reconcileAlbumsForArtist(
      ARTIST_MBID,
      [album({ title: 'Dummy', releaseYear: 2021 })],
      { mbClient },
    )

    expect(rows[0]).toMatchObject({
      albumMbid: null,
      matchMethod: null,
      matchConfidence: null,
      releaseYear: 2021,
      titleNormalized: 'dummy',
      unreconciledReason: 'ambiguous',
    })
  })

  it('leaves the row unreconciled when one candidate matches the year and another has unknown year', async () => {
    const mbClient = {
      getReleaseGroups: vi.fn().mockResolvedValue([
        { id: ALBUM_MBID, title: 'Dummy', type: 'Album', firstReleaseDate: '2021-01-01' },
        { id: ALBUM_MBID_2, title: 'Dummy', type: 'Album' },
      ]),
    }

    const rows = await reconcileAlbumsForArtist(
      ARTIST_MBID,
      [album({ title: 'Dummy', releaseYear: 2021 })],
      { mbClient },
    )

    expect(rows[0]).toMatchObject({
      albumMbid: null,
      matchMethod: null,
      matchConfidence: null,
      releaseYear: 2021,
      titleNormalized: 'dummy',
      unreconciledReason: 'ambiguous',
    })
  })

  it('leaves the row unreconciled when title candidates stay ambiguous', async () => {
    const mbClient = {
      getReleaseGroups: vi.fn().mockResolvedValue([
        { id: ALBUM_MBID, title: 'Dummy', type: 'Album', firstReleaseDate: '1991-01-01' },
        { id: ALBUM_MBID_2, title: 'Dummy', type: 'Album', firstReleaseDate: '2021-01-01' },
      ]),
    }

    const rows = await reconcileAlbumsForArtist(ARTIST_MBID, [album({ title: 'Dummy' })], {
      mbClient,
    })

    expect(rows[0]).toMatchObject({
      albumMbid: null,
      matchMethod: null,
      matchConfidence: null,
      titleNormalized: 'dummy',
      unreconciledReason: 'ambiguous',
    })
  })

  it('degrades gracefully when MB getReleaseGroups throws 503', async () => {
    const mbClient = {
      getReleaseGroups: vi
        .fn()
        .mockRejectedValue(new Error('MusicBrainz HTTP 503 for /release-group?...')),
    }
    const onMbError = vi.fn()

    const rows = await reconcileAlbumsForArtist(
      ARTIST_MBID,
      [
        album({ sourceAlbumId: 'src-1', title: 'Stranger Things', releaseYear: 2019 }),
        album({ sourceAlbumId: 'src-2', title: 'Dummy' }),
      ],
      { mbClient, onMbError },
    )

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.unreconciledReason)).toEqual(['lookup_failed', 'lookup_failed'])
    expect(rows[0]).toMatchObject({
      albumMbid: null,
      artistMbid: ARTIST_MBID,
      matchMethod: null,
      matchConfidence: null,
      releaseYear: 2019,
    })
    expect(onMbError).toHaveBeenCalledOnce()
  })
})

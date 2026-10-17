// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { getOwnedAlbumKeys } from '@/db/queries/library-albums'

describe('getOwnedAlbumKeys', () => {
  it('keys MBID rows by release group and MBID-less rows by artist and title', async () => {
    const where = vi.fn().mockResolvedValue([
      { albumMbid: 'rg-1', artistMbid: 'a-1', titleNormalized: 'one' },
      { albumMbid: null, artistMbid: 'a-2', titleNormalized: 'two' },
      { albumMbid: null, artistMbid: null, titleNormalized: 'three' },
    ])
    const db = { select: () => ({ from: () => ({ where }) }) } as unknown as Database

    const keys = await getOwnedAlbumKeys(db, 7)

    expect([...keys.releaseGroupMbids]).toEqual(['rg-1'])
    expect([...keys.artistTitleKeys]).toEqual(['a-2|two'])
    expect(where).toHaveBeenCalledOnce()
  })
})

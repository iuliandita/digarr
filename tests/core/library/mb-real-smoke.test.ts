// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { normalizeArtistName } from '@/core/library/normalize'

const SHOULD_RUN = process.env.RUN_MB_SMOKE === '1'
const BEATLES_MBID = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d'

describe.skipIf(!SHOULD_RUN)('MusicBrainz real smoke test', () => {
  it('searchArtist for beatles returns the expected artist among normalized matches', async () => {
    const mb = createMusicBrainzClient()
    const result = await mb.searchArtist('beatles')
    const matching = result.artists.filter(
      (artist) => normalizeArtistName(artist.name) === 'beatles',
    )

    expect(matching.length).toBeGreaterThan(0)
    expect(matching.some((artist) => artist.id === BEATLES_MBID)).toBe(true)
  })

  it('getReleaseGroups for The Beatles returns known album data', async () => {
    const mb = createMusicBrainzClient()
    const releases = await mb.getReleaseGroups(BEATLES_MBID)

    expect(releases.length).toBeGreaterThan(10)
    expect(releases.some((release) => release.title.toLowerCase().includes('abbey road'))).toBe(
      true,
    )
  })
})

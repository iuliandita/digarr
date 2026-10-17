import { describe, expect, it } from 'vitest'
import { shouldDropAlbumCandidate } from '@/core/pipeline/orchestrator'

const sets = {
  blockedArtistMbids: new Set(['blocked-artist']),
  blockedAlbumKeys: new Set(['blocked-rg']),
  existingAlbumRgs: new Set(['existing-rg']),
  owned: {
    releaseGroupMbids: new Set(['owned-rg']),
    artistTitleKeys: new Set(['artist-1|owned title']),
  },
}

describe('shouldDropAlbumCandidate', () => {
  it('drops when artist is blocked (cascade)', () => {
    expect(
      shouldDropAlbumCandidate({ artistMbid: 'blocked-artist', releaseGroupMbid: 'rg' }, sets),
    ).toBe(true)
  })
  it('drops when the album is blocked', () => {
    expect(
      shouldDropAlbumCandidate({ artistMbid: 'a', releaseGroupMbid: 'blocked-rg' }, sets),
    ).toBe(true)
  })
  it('drops when the album is already recommended', () => {
    expect(
      shouldDropAlbumCandidate({ artistMbid: 'a', releaseGroupMbid: 'existing-rg' }, sets),
    ).toBe(true)
  })
  it('keeps a fresh album for an unblocked artist', () => {
    expect(shouldDropAlbumCandidate({ artistMbid: 'a', releaseGroupMbid: 'rg' }, sets)).toBe(false)
  })
  it('drops an album already owned in the library by release group', () => {
    expect(shouldDropAlbumCandidate({ artistMbid: 'a', releaseGroupMbid: 'owned-rg' }, sets)).toBe(
      true,
    )
  })
  it('drops an owned album without an MBID via normalized artist and title', () => {
    expect(
      shouldDropAlbumCandidate(
        { artistMbid: 'artist-1', releaseGroupMbid: 'rg-x', title: 'Owned Title (Deluxe Edition)' },
        sets,
      ),
    ).toBe(true)
  })
  it('keeps a same-titled album from a different artist', () => {
    expect(
      shouldDropAlbumCandidate(
        { artistMbid: 'artist-2', releaseGroupMbid: 'rg-x', title: 'Owned Title' },
        sets,
      ),
    ).toBe(false)
  })
})

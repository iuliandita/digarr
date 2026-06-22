import { describe, expect, it } from 'vitest'
import { shouldDropAlbumCandidate } from '@/core/pipeline/orchestrator'

const sets = {
  blockedArtistMbids: new Set(['blocked-artist']),
  blockedAlbumKeys: new Set(['blocked-rg']),
  existingAlbumRgs: new Set(['existing-rg']),
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
})

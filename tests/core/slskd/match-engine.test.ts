// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SlskdSearchResult } from '@/core/clients/slskd'
import { scoreSlskdCandidate, selectBestSlskdCandidate } from '@/core/slskd/match-engine'

const release = {
  artistName: 'Radiohead',
  releaseTitle: 'OK Computer',
}

describe('scoreSlskdCandidate()', () => {
  it('gives high confidence to an exact album match in preferred quality', () => {
    const candidate: SlskdSearchResult = {
      id: 'result-1',
      filename: 'Radiohead - OK Computer.flac',
      username: 'listener',
      size: 123,
    }

    const scored = scoreSlskdCandidate(release, candidate)

    expect(scored.confidence).toBeGreaterThan(0.9)
  })
})

describe('selectBestSlskdCandidate()', () => {
  it('returns needs_review for ambiguous weak matches', () => {
    const candidates: SlskdSearchResult[] = [
      {
        id: 'result-1',
        filename: 'Radiohead - The Best Of.mp3',
        username: 'listener1',
        size: 123,
      },
      {
        id: 'result-2',
        filename: 'Radiohead - A Collection.mp3',
        username: 'listener2',
        size: 123,
      },
    ]

    const selected = selectBestSlskdCandidate(release, candidates)

    expect(selected.decision).toBe('needs_review')
  })

  it('returns needs_review for non-audio artifacts even when artist and title match', () => {
    const candidates: SlskdSearchResult[] = [
      {
        id: 'result-3',
        filename: 'Radiohead - OK Computer.cue',
        username: 'listener3',
        size: 123,
      },
    ]

    const selected = selectBestSlskdCandidate(release, candidates)

    expect(selected.decision).toBe('needs_review')
  })
})

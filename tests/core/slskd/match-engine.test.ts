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

describe('scoreSlskdCandidate() artist names with dots', () => {
  it.each(['Dr. Dre - 2001', 'Dr. Dre - 2001.flac'])('keeps "Dr. Dre" in %s', (filename) => {
    const scored = scoreSlskdCandidate(
      { artistName: 'Dr. Dre', releaseTitle: '2001' },
      { filename },
    )
    expect(scored.artistMatch).toBe(true)
    expect(scored.titleMatch).toBe(true)
  })
})

describe('selectBestSlskdCandidate()', () => {
  it('queues an exact audio release with cover art and metadata companions', () => {
    const selected = selectBestSlskdCandidate(release, [
      {
        id: 'release-with-art',
        filename: 'Radiohead - OK Computer',
        username: 'listener',
        size: 300,
        files: [
          { filename: 'Radiohead - OK Computer\\01.flac', size: 100 },
          { filename: 'Radiohead - OK Computer\\cover.jpg', size: 100 },
          { filename: 'Radiohead - OK Computer\\album.cue', size: 100 },
        ],
      },
    ])
    expect(selected.decision).toBe('auto_queue')
  })

  const peer = (username: string, extra: Partial<SlskdSearchResult> = {}): SlskdSearchResult => ({
    id: username,
    filename: 'Radiohead - OK Computer',
    username,
    size: 100,
    files: [{ filename: 'Radiohead\\OK Computer\\01.flac', size: 100 }],
    ...extra,
  })

  it.each([
    [
      'free slot beats a queue',
      [
        peer('queued', { queueLength: 0 }),
        peer('free', { hasFreeUploadSlot: true, queueLength: 9 }),
      ],
      'free',
    ],
    [
      'shorter queue beats a longer one',
      [
        peer('long', { hasFreeUploadSlot: false, queueLength: 5 }),
        peer('short', { hasFreeUploadSlot: false, queueLength: 1 }),
      ],
      'short',
    ],
    [
      'faster upload breaks a queue tie',
      [
        peer('slow', { queueLength: 2, uploadSpeed: 10 }),
        peer('fast', { queueLength: 2, uploadSpeed: 99 }),
      ],
      'fast',
    ],
    [
      'missing stats rank last',
      [
        peer('unknown'),
        peer('known', { hasFreeUploadSlot: false, queueLength: 50, uploadSpeed: 1 }),
      ],
      'known',
    ],
  ])(
    'auto-queues a release shared by several peers and prefers peer signals: %s',
    (_name, candidates, winner) => {
      const selected = selectBestSlskdCandidate(release, candidates)

      expect(selected.decision).toBe('auto_queue')
      expect(selected.candidate?.username).toBe(winner)
    },
  )

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

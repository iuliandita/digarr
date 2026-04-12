import type { SlskdSearchResult } from '@/core/clients/slskd'
import { normalizeAlbumTitle, normalizeArtistName } from '@/core/library/normalize'
import type { SlskdMatchDecision, SlskdMatchRelease, SlskdMatchScore } from './types'

function normalizeText(raw: string): string {
  if (!raw.trim()) return ''

  let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.toLowerCase()
  s = s.replace(/[_/\\]+/g, ' ')
  s = s.replace(/[“”"'`]/g, '')
  s = s.replace(/[()[\]{}]+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

function splitCandidateFilename(filename: string): { artist: string; title: string } {
  const stem = filename.replace(/\.[^.]+$/, '')
  const separators = [' - ', ' – ', ' — ']

  for (const separator of separators) {
    const index = stem.indexOf(separator)
    if (index > 0) {
      return {
        artist: stem.slice(0, index),
        title: stem.slice(index + separator.length),
      }
    }
  }

  return { artist: stem, title: stem }
}

function qualityMatches(release: SlskdMatchRelease, candidate: SlskdSearchResult): boolean {
  const preference = release.qualityPreference ?? 'flac_preferred'
  const extension = candidate.extension?.toLowerCase() ?? candidate.filename.split('.').pop()?.toLowerCase()

  if (preference === 'flac_preferred') {
    return extension === 'flac'
  }

  return extension === 'mp3' || extension === 'm4a' || extension === 'aac'
}

export function scoreSlskdCandidate(
  release: SlskdMatchRelease,
  candidate: SlskdSearchResult,
): SlskdMatchScore {
  const { artist, title } = splitCandidateFilename(candidate.filename)
  const normalizedArtist = normalizeText(normalizeArtistName(release.artistName))
  const normalizedTitle = normalizeText(normalizeAlbumTitle(release.title))
  const normalizedCandidateArtist = normalizeText(normalizeArtistName(artist))
  const normalizedCandidateTitle = normalizeText(normalizeAlbumTitle(title))

  const artistMatch = normalizedArtist === normalizedCandidateArtist && normalizedArtist !== ''
  const titleMatch = normalizedTitle === normalizedCandidateTitle && normalizedTitle !== ''
  const qualityMatch = qualityMatches(release, candidate)

  let confidence = 0
  if (artistMatch) confidence += 0.48
  if (titleMatch) confidence += 0.47
  if (qualityMatch) confidence += 0.08

  if (artistMatch && titleMatch) confidence += 0.02
  if (candidate.bitrate !== undefined && candidate.bitrate >= 900) confidence += 0.02

  confidence = Math.max(0, Math.min(1, confidence))

  return {
    confidence,
    artistMatch,
    titleMatch,
    qualityMatch,
    normalizedArtist,
    normalizedTitle,
    normalizedCandidateArtist,
    normalizedCandidateTitle,
  }
}

export function selectBestSlskdCandidate(
  release: SlskdMatchRelease,
  candidates: SlskdSearchResult[],
): SlskdMatchDecision {
  if (candidates.length === 0) {
    return { status: 'needs_review', confidence: 0, reason: 'low_confidence' }
  }

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreSlskdCandidate(release, candidate) }))
    .sort((a, b) => b.score.confidence - a.score.confidence)

  const best = scored[0]
  const second = scored[1]

  if (!best) {
    return { status: 'needs_review', confidence: 0, reason: 'low_confidence' }
  }

  const gap = best.score.confidence - (second?.score.confidence ?? 0)
  const confidentEnough = best.score.confidence >= 0.9
  const clearWinner = gap >= 0.12

  if (!confidentEnough) {
    return { status: 'needs_review', confidence: best.score.confidence, reason: 'low_confidence' }
  }

  if (!clearWinner) {
    return { status: 'needs_review', confidence: best.score.confidence, reason: 'ambiguous' }
  }

  return {
    status: 'auto_queue',
    candidate: best.candidate,
    confidence: best.score.confidence,
  }
}


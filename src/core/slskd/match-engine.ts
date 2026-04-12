import type { SlskdSearchResult } from '@/core/clients/slskd'
import { normalizeAlbumTitle, normalizeArtistName } from '@/core/library/normalize'
import type { QualityPreference } from './types'

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

const AUDIO_EXTENSIONS = new Set([
  'flac',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'alac',
  'wma',
])

function getFilenameExtension(filename: string): string | undefined {
  return filename.split('.').pop()?.toLowerCase()
}

function qualityMatches(
  preference: QualityPreference | undefined,
  candidate: Pick<SlskdSearchResult, 'filename'>,
): boolean {
  const extension = getFilenameExtension(candidate.filename)

  if (extension === undefined || !AUDIO_EXTENSIONS.has(extension)) {
    return false
  }

  switch (preference) {
    case 'lossless_only':
    case 'flac_preferred':
      return extension === 'flac'
    default:
      return extension !== undefined
  }
}

export function scoreSlskdCandidate(
  release: { artistName: string; releaseTitle: string },
  candidate: Pick<SlskdSearchResult, 'filename'>,
) {
  const { artist, title } = splitCandidateFilename(candidate.filename)
  const extension = getFilenameExtension(candidate.filename)
  const normalizedArtist = normalizeText(normalizeArtistName(release.artistName))
  const normalizedTitle = normalizeText(normalizeAlbumTitle(release.releaseTitle))
  const normalizedCandidateArtist = normalizeText(normalizeArtistName(artist))
  const normalizedCandidateTitle = normalizeText(normalizeAlbumTitle(title))

  const artistMatch = normalizedArtist === normalizedCandidateArtist && normalizedArtist !== ''
  const titleMatch = normalizedTitle === normalizedCandidateTitle && normalizedTitle !== ''
  const qualityMatch = qualityMatches(undefined, candidate)

  if (extension === undefined || !AUDIO_EXTENSIONS.has(extension)) {
    return {
      confidence: 0,
      artistMatch,
      titleMatch,
      qualityMatch,
      normalizedArtist,
      normalizedTitle,
      normalizedCandidateArtist,
      normalizedCandidateTitle,
    }
  }

  let confidence = 0
  if (artistMatch) confidence += 0.49
  if (titleMatch) confidence += 0.46
  if (qualityMatch) confidence += 0.04

  if (artistMatch && titleMatch) confidence += 0.02

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
  release: { artistName: string; releaseTitle: string },
  candidates: SlskdSearchResult[],
): { decision: 'needs_review' | 'auto_queue'; candidate?: SlskdSearchResult; confidence: number } {
  if (candidates.length === 0) {
    return { decision: 'needs_review', confidence: 0 }
  }

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreSlskdCandidate(release, candidate) }))
    .sort((a, b) => b.score.confidence - a.score.confidence)

  const best = scored[0]
  const second = scored[1]

  if (!best) {
    return { decision: 'needs_review', confidence: 0 }
  }

  const gap = best.score.confidence - (second?.score.confidence ?? 0)
  const confidentEnough = best.score.confidence > 0.9
  const clearWinner = gap >= 0.1

  if (!confidentEnough) {
    return { decision: 'needs_review', confidence: best.score.confidence }
  }

  if (!clearWinner) {
    return { decision: 'needs_review', confidence: best.score.confidence }
  }

  return {
    decision: 'auto_queue',
    candidate: best.candidate,
    confidence: best.score.confidence,
  }
}

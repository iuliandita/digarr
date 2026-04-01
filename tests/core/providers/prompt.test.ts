// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildMoodPrompt,
  buildRecommendationPrompt,
  parseRecommendationResponse,
} from '@/core/providers/prompt'
import type { TasteProfile } from '@/core/types'

const sampleProfile: TasteProfile = {
  topArtists: [{ name: 'Boards of Canada', mbid: 'abc', playCount: 500, source: 'listenbrainz' }],
  topGenres: [{ name: 'ambient', weight: 0.8 }],
  listeningPatterns: { totalListens: 10000, recentTrend: 'stable' },
}

describe('buildRecommendationPrompt()', () => {
  it('includes suggestedAlbum in the field list', () => {
    const prompt = buildRecommendationPrompt(sampleProfile)
    expect(prompt).toContain('suggestedAlbum')
    expect(prompt).toContain('the best album to start with for a new listener')
  })

  it('includes suggestedAlbum in the JSON example', () => {
    const prompt = buildRecommendationPrompt(sampleProfile)
    expect(prompt).toContain('"suggestedAlbum"')
    expect(prompt).toContain('Dragging a Dead Deer Up a Hill')
  })

  it('includes name-description consistency warning', () => {
    const prompt = buildRecommendationPrompt(sampleProfile)
    expect(prompt).toContain('Do not confuse similarly-named artists')
    expect(prompt).toContain('reasoning accurately describes the EXACT artist')
  })
})

describe('buildMoodPrompt()', () => {
  it('includes name-description consistency warning', () => {
    const prompt = buildMoodPrompt('chill ambient vibes')
    expect(prompt).toContain('Do not confuse similarly-named artists')
  })
})

describe('parseRecommendationResponse()', () => {
  it('extracts suggestedAlbum when present', () => {
    const response = JSON.stringify([
      {
        artistName: 'Grouper',
        reasoning: 'Ambient folk artist with hazy soundscapes.',
        confidence: 0.87,
        genres: ['ambient', 'drone'],
        suggestedAlbum: 'Dragging a Dead Deer Up a Hill',
      },
    ])

    const result = parseRecommendationResponse(response)

    expect(result).toHaveLength(1)
    expect(result[0]?.suggestedAlbum).toBe('Dragging a Dead Deer Up a Hill')
  })

  it('handles missing suggestedAlbum gracefully', () => {
    const response = JSON.stringify([
      {
        artistName: 'Burial',
        reasoning: 'Dark electronic producer from London.',
        confidence: 0.9,
        genres: ['dubstep', 'electronic'],
      },
    ])

    const result = parseRecommendationResponse(response)

    expect(result).toHaveLength(1)
    expect(result[0]?.suggestedAlbum).toBeUndefined()
  })

  it('handles brackets inside JSON string values', () => {
    const response = JSON.stringify([
      {
        artistName: 'Radiohead',
        reasoning: 'Known for OK Computer [Remastered].',
        confidence: 0.9,
        genres: ['alternative'],
        suggestedAlbum: 'OK Computer [Deluxe Edition]',
      },
    ])

    const result = parseRecommendationResponse(response)

    expect(result).toHaveLength(1)
    expect(result[0]?.suggestedAlbum).toBe('OK Computer [Deluxe Edition]')
  })

  it('handles escaped backslashes before quotes in strings', () => {
    // JSON: {"reasoning": "path\\"} -- literal backslash then closing quote
    const response =
      '[{"artistName":"Test","reasoning":"a path\\\\","confidence":0.8,"genres":["rock"]}]'

    const result = parseRecommendationResponse(response)

    expect(result).toHaveLength(1)
    expect(result[0]?.artistName).toBe('Test')
  })

  it('ignores non-string suggestedAlbum values', () => {
    const response = JSON.stringify([
      {
        artistName: 'Four Tet',
        reasoning: 'Experimental electronic producer.',
        confidence: 0.8,
        genres: ['electronic'],
        suggestedAlbum: 42,
      },
    ])

    const result = parseRecommendationResponse(response)

    expect(result).toHaveLength(1)
    expect(result[0]?.suggestedAlbum).toBeUndefined()
  })
})

import type { AiRecommendation, TasteProfile } from '@/core/types'

export function buildRecommendationPrompt(profile: TasteProfile): string {
  if (profile._rawPrompt) return profile._rawPrompt

  const topArtistNames = profile.topArtists
    .slice(0, 20)
    .map((a) => `${a.name} (${a.playCount} plays)`)
    .join(', ')

  const topGenres = profile.topGenres
    .slice(0, 10)
    .map((g) => `${g.name} (weight: ${g.weight.toFixed(2)})`)
    .join(', ')

  const trend = profile.listeningPatterns.recentTrend
  const totalListens = profile.listeningPatterns.totalListens

  return `You are a music discovery expert. Based on the following listening profile, recommend 15-20 artists the listener has NOT heard yet but would likely enjoy.

## Listening Profile

**Top Artists:** ${topArtistNames || 'none recorded'}

**Top Genres:** ${topGenres || 'none recorded'}

**Listening Patterns:**
- Total listens: ${totalListens}
- Recent trend: ${trend}

## Instructions

Return ONLY a JSON array with no additional text. Each element must have these fields:
- artistName: string (the artist's name)
- reasoning: string (2-3 sentences: first describe what this artist sounds like and what they're known for, then explain why they match this listener's taste)
- confidence: number (0.0 to 1.0, how confident you are in this recommendation)
- genres: string[] (list of genres this artist represents)
- suggestedAlbum: string (optional -- the best album to start with for a new listener)

Example:
[
  {
    "artistName": "Grouper",
    "reasoning": "Grouper is the project of Portland-based artist Liz Harris, known for hazy, lo-fi ambient folk layered with ethereal vocals and droning guitars. Fans of ambient and drone music with introspective themes often connect deeply with her immersive, meditative soundscapes.",
    "confidence": 0.87,
    "genres": ["ambient", "drone", "indie folk"],
    "suggestedAlbum": "Dragging a Dead Deer Up a Hill"
  }
]

IMPORTANT: For each recommendation, verify that the reasoning accurately describes the EXACT artist named in artistName. Do not confuse similarly-named artists (e.g., "Velvet Underground" and "Digital Underground" are completely different artists). The genres field must match the actual genres of the named artist.

Provide 15-20 diverse recommendations. Prioritize lesser-known artists alongside some well-known ones. Do not include artists already in the listener's top artists list.`
}

export function buildMoodPrompt(query: string, excludeArtists: string[] = []): string {
  const exclusionClause =
    excludeArtists.length > 0
      ? `\n\nDo NOT recommend any of these artists (already in library): ${excludeArtists.join(', ')}`
      : ''

  return `You are a music discovery expert. A listener described what they want to hear:

"${query}"

Recommend 10-15 artists that match this mood, vibe, or description. Prioritize lesser-known artists alongside a few well-known anchors.

Return ONLY a JSON array. Each element must have:
- artistName: string
- reasoning: string (2-3 sentences describing the artist and why they match)
- confidence: number (0.0-1.0)
- genres: string[]
- suggestedAlbum: string (optional)

IMPORTANT: For each recommendation, verify that the reasoning accurately describes the EXACT artist named in artistName. Do not confuse similarly-named artists. The genres field must match the actual genres of the named artist.${exclusionClause}`
}

export function parseRecommendationResponse(text: string): AiRecommendation[] {
  // Strip markdown code fences if present
  let cleaned = text.trim()

  const codeFenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeFenceMatch) {
    cleaned = codeFenceMatch[1]?.trim() ?? cleaned
  }

  // Find the JSON array - look for the first '[' and match to its closing ']'
  const arrayStart = cleaned.indexOf('[')
  if (arrayStart === -1) {
    throw new Error('No JSON array found in AI response')
  }

  // Extract from array start; track string context so brackets inside
  // JSON string values (e.g. "[Deluxe Edition]") don't confuse depth
  let depth = 0
  let arrayEnd = -1
  let inString = false
  for (let i = arrayStart; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (ch === '"') {
      let backslashes = 0
      for (let k = i - 1; k >= 0 && cleaned[k] === '\\'; k--) backslashes++
      if (backslashes % 2 === 0) {
        inString = !inString
        continue
      }
    }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        arrayEnd = i
        break
      }
    }
  }

  if (arrayEnd === -1) {
    throw new Error('Malformed JSON array in AI response')
  }

  const jsonStr = cleaned.slice(arrayStart, arrayEnd + 1)
  const parsed: unknown = JSON.parse(jsonStr)

  if (!Array.isArray(parsed)) {
    throw new Error('AI response did not contain an array')
  }

  return parsed
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .filter(
      (item) =>
        typeof item.artistName === 'string' &&
        typeof item.reasoning === 'string' &&
        typeof item.confidence === 'number' &&
        Array.isArray(item.genres),
    )
    .map((item) => ({
      artistName: item.artistName as string,
      reasoning: item.reasoning as string,
      confidence: item.confidence as number,
      genres: (item.genres as unknown[]).filter((g): g is string => typeof g === 'string'),
      suggestedAlbum: typeof item.suggestedAlbum === 'string' ? item.suggestedAlbum : undefined,
    }))
}

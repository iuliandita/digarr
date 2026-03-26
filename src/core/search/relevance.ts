function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toCompact(value: string): string {
  return value.replace(/\s+/g, '')
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

export function computeNameRelevance(query: string, candidate: string): number {
  const normalizedQuery = normalizeSearchText(query)
  const normalizedCandidate = normalizeSearchText(candidate)
  if (!normalizedQuery || !normalizedCandidate) return 0

  const compactQuery = toCompact(normalizedQuery)
  const compactCandidate = toCompact(normalizedCandidate)
  const queryTokens = tokenize(normalizedQuery)
  const candidateTokens = tokenize(normalizedCandidate)

  if (normalizedCandidate === normalizedQuery || compactCandidate === compactQuery) {
    return 1
  }

  let score = 0

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    score = Math.max(score, 0.92)
  }

  if (normalizedCandidate.includes(` ${normalizedQuery}`)) {
    score = Math.max(score, 0.82)
  }

  if (compactCandidate.includes(compactQuery)) {
    score = Math.max(score, 0.76)
  }

  let exactTokenMatches = 0
  let prefixTokenMatches = 0

  for (const token of queryTokens) {
    if (candidateTokens.includes(token)) {
      exactTokenMatches += 1
      continue
    }
    if (candidateTokens.some((candidateToken) => candidateToken.startsWith(token))) {
      prefixTokenMatches += 1
    }
  }

  const tokenCoverage =
    (exactTokenMatches + prefixTokenMatches * 0.6) / Math.max(queryTokens.length, 1)
  score = Math.max(score, tokenCoverage * 0.78)

  const extraTokenPenalty = Math.max(candidateTokens.length - queryTokens.length, 0) * 0.035

  return Math.max(0, Math.min(1, score - Math.min(extraTokenPenalty, 0.18)))
}

type RankOptions<T> = {
  limit: number
  maxResults?: number
  minScore?: number
  fallbackResults?: number
  getName: (item: T) => string
  getTieBreaker?: (item: T) => number
  getBaseScore?: (item: T) => number
  baseScoreWeight?: number
}

export function rankSearchMatches<T>(items: T[], query: string, options: RankOptions<T>): T[] {
  const weightedBase = options.baseScoreWeight ?? 0
  const scored = items
    .map((item) => {
      const relevance = computeNameRelevance(query, options.getName(item))
      const baseScore = options.getBaseScore ? options.getBaseScore(item) : 0
      return {
        item,
        score: relevance * (1 - weightedBase) + baseScore * weightedBase,
        relevance,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const tieA = options.getTieBreaker ? options.getTieBreaker(a.item) : 0
      const tieB = options.getTieBreaker ? options.getTieBreaker(b.item) : 0
      return tieB - tieA
    })

  const threshold = options.minScore ?? 0
  const filtered = scored.filter((entry) => entry.relevance >= threshold)
  const effective = filtered.length > 0 ? filtered : scored.slice(0, options.fallbackResults ?? 3)
  const cap = Math.min(options.maxResults ?? options.limit, options.limit)

  return effective.slice(0, cap).map((entry) => entry.item)
}

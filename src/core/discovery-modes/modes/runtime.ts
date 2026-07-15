import type { DiscoveryModeRequest } from '../request'

export async function getDiscoveryModeConnections(userId: number) {
  const [{ db }, { getUserConnections }] = await Promise.all([
    import('@/db'),
    import('@/db/queries/users'),
  ])
  return getUserConnections(db, userId)
}

export async function getDiscoveryModeSkipTlsVerify(): Promise<boolean> {
  const [{ db }, { getSettings }] = await Promise.all([
    import('@/db'),
    import('@/db/queries/settings'),
  ])
  const settings = await getSettings(db)
  return settings?.skipTlsVerify ?? false
}

export async function getDiscoveryModeSpotifyToken(userId: number): Promise<string | null> {
  try {
    const [{ db }, { resolveSpotifyToken }] = await Promise.all([
      import('@/db'),
      import('@/core/spotify-auth'),
    ])
    return await resolveSpotifyToken(db, userId)
  } catch {
    return null
  }
}

export async function getDiscoveryModeDeezerToken(userId: number): Promise<string | null> {
  try {
    const [{ db }, { resolveDeezerToken }] = await Promise.all([
      import('@/db'),
      import('@/core/deezer-auth'),
    ])
    return await resolveDeezerToken(db, userId)
  } catch {
    return null
  }
}

export function getNormalizedLimit(
  request: DiscoveryModeRequest,
  fallback: number,
  max = 50,
): number {
  const value = Number(request.normalizedSettings.limit ?? fallback)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), max)
}

export function getProviderPath(request: DiscoveryModeRequest): string[] {
  const providerPath = request.providerContext.providerPath
  if (!Array.isArray(providerPath)) return []

  return providerPath.filter((value): value is string => typeof value === 'string')
}

export function normalizeDiscoveryName(name: string): string {
  return name.trim().toLowerCase()
}

export type SeedArtist = { name: string; mbid?: string }

export function parseSeeds(raw: unknown): SeedArtist[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((s) => s.trim())
      : []
  const seeds: SeedArtist[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim()) seeds.push({ name: item.trim() })
    } else if (item && typeof item === 'object' && 'name' in item) {
      const rec = item as Record<string, unknown>
      const name = String(rec.name ?? '').trim()
      if (name) seeds.push({ name, mbid: typeof rec.mbid === 'string' ? rec.mbid : undefined })
    }
  }
  return seeds
}

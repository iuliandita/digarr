import type { OAuthProvider, ProviderAuthReason } from '@/core/provider-auth'
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

export type DiscoveryModeTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: ProviderAuthReason; message: string }

/**
 * Resolve a provider token for a discovery run, keeping the real failure
 * instead of flattening every cause into "not connected".
 */
export async function resolveDiscoveryModeProviderToken(
  userId: number,
  provider: OAuthProvider,
): Promise<DiscoveryModeTokenResult> {
  try {
    const [{ db }, { resolveProviderToken }] = await Promise.all([
      import('@/db'),
      import('@/core/provider-auth'),
    ])
    return { ok: true, token: await resolveProviderToken(db, userId, provider) }
  } catch (err) {
    const { ProviderAuthError, providerLabel } = await import('@/core/provider-auth')
    const label = providerLabel(provider)
    if (err instanceof ProviderAuthError && err.reason === 'not_connected') {
      return { ok: false, reason: 'not_connected', message: `Connect ${label} to use this mode.` }
    }
    console.error(`[discovery] ${provider} token unusable for user ${userId}:`, err)
    return {
      ok: false,
      reason: 'token_unusable',
      message: `Your ${label} connection is no longer usable - reconnect ${label} in Settings.`,
    }
  }
}

/** Token or null, for callers that treat an unavailable provider as a soft miss. */
export async function getDiscoveryModeProviderToken(
  userId: number,
  provider: OAuthProvider,
): Promise<string | null> {
  const result = await resolveDiscoveryModeProviderToken(userId, provider)
  return result.ok ? result.token : null
}

/** Token or a throw that names the actual failure. */
export async function requireDiscoveryModeProviderToken(
  userId: number,
  provider: OAuthProvider,
): Promise<string> {
  const result = await resolveDiscoveryModeProviderToken(userId, provider)
  if (!result.ok) throw new Error(result.message)
  return result.token
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

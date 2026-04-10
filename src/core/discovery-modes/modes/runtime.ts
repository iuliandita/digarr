import { resolveSpotifyToken } from '@/core/spotify-auth'
import { db } from '@/db'
import { getUserConnections } from '@/db/queries/users'
import type { DiscoveryModeRequest } from '../request'

export async function getDiscoveryModeConnections(userId: number) {
  return getUserConnections(db, userId)
}

export async function getDiscoveryModeSpotifyToken(userId: number): Promise<string | null> {
  try {
    return await resolveSpotifyToken(db, userId)
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

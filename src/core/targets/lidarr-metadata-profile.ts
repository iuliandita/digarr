import type { LidarrAlbumLookup, MetadataProfile } from '@/core/clients/lidarr'

export type ReleaseGroupTypes = {
  primaryType?: string | null
  /** Undefined means unknown; an empty list is Lidarr's "Studio". */
  secondaryTypes?: string[] | null
  releaseStatuses?: string[] | null
}

export type ProfileRejection = {
  reason: 'primary' | 'secondary' | 'status'
  types: string[]
}

function allowedNames(
  items: Array<{ allowed?: boolean; name?: string }> | undefined,
): Set<string> | null {
  if (!Array.isArray(items) || items.length === 0) return null
  return new Set(
    items.flatMap((item) => (item.allowed && item.name ? [item.name.toLowerCase()] : [])),
  )
}

/**
 * Mirrors Lidarr's SkyHookProxy.FilterAlbums: the primary type must be allowed,
 * a release group without secondary types needs "Studio", one with secondary
 * types needs any of them allowed, and any release status must be allowed.
 * Unknown types (or a profile without type lists) never reject.
 */
export function metadataProfileRejection(
  profile: MetadataProfile,
  types: ReleaseGroupTypes,
): ProfileRejection | null {
  const primary = allowedNames(
    profile.primaryAlbumTypes?.map((item) => ({ ...item, name: item.albumType?.name })),
  )
  if (primary && types.primaryType && !primary.has(types.primaryType.toLowerCase())) {
    return { reason: 'primary', types: [types.primaryType] }
  }

  const secondary = allowedNames(
    profile.secondaryAlbumTypes?.map((item) => ({ ...item, name: item.albumType?.name })),
  )
  if (secondary && Array.isArray(types.secondaryTypes)) {
    const wanted = types.secondaryTypes.length > 0 ? types.secondaryTypes : ['Studio']
    if (!wanted.some((type) => secondary.has(type.toLowerCase()))) {
      return { reason: 'secondary', types: wanted }
    }
  }

  const statuses = allowedNames(
    profile.releaseStatuses?.map((item) => ({ ...item, name: item.releaseStatus?.name })),
  )
  const releaseStatuses = types.releaseStatuses?.filter(Boolean) ?? []
  if (
    statuses &&
    releaseStatuses.length > 0 &&
    !releaseStatuses.some((status) => statuses.has(status.toLowerCase()))
  ) {
    return { reason: 'status', types: [...new Set(releaseStatuses)] }
  }
  return null
}

// Lidarr falls back to its first profile when the requested id is gone.
export function effectiveMetadataProfile(
  profiles: MetadataProfile[],
  id: number | undefined,
): MetadataProfile | undefined {
  return profiles.find((profile) => profile.id === id) ?? profiles[0]
}

export function lookupToReleaseGroupTypes(album: LidarrAlbumLookup): ReleaseGroupTypes {
  return {
    primaryType: album.albumType ?? null,
    secondaryTypes: Array.isArray(album.secondaryTypes) ? album.secondaryTypes : undefined,
    releaseStatuses: (album.releases ?? [])
      .map((release) => release.status)
      .filter((status): status is string => typeof status === 'string'),
  }
}

export function profileRejectionMessage(profileName: string, rejection: ProfileRejection): string {
  const types = rejection.types.join('/')
  const subject =
    rejection.reason === 'status' ? `${types} release status isn't` : `${types} releases aren't`
  return `${subject} allowed by the Lidarr metadata profile "${profileName}" - allow that in Lidarr or pick a different metadata profile for this artist`
}

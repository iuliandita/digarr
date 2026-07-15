import {
  createJellyfinFamilyPlaylistTarget,
  type JellyfinFamilyPlaylistConfig,
} from './jellyfin-family-playlist'
import type { DestinationTarget } from './types'

export type JellyfinPlaylistConfig = JellyfinFamilyPlaylistConfig

export function createJellyfinPlaylistTarget(
  targetId: number,
  config: JellyfinPlaylistConfig,
): DestinationTarget {
  return createJellyfinFamilyPlaylistTarget(targetId, config, {
    type: 'jellyfin-playlist',
    serviceName: 'Jellyfin',
  })
}

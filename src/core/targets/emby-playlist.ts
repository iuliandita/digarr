import {
  createJellyfinFamilyPlaylistTarget,
  type JellyfinFamilyPlaylistConfig,
} from './jellyfin-family-playlist'
import type { DestinationTarget } from './types'

export type EmbyPlaylistConfig = JellyfinFamilyPlaylistConfig

export function createEmbyPlaylistTarget(
  targetId: number,
  config: EmbyPlaylistConfig,
): DestinationTarget {
  return createJellyfinFamilyPlaylistTarget(targetId, config, {
    type: 'emby-playlist',
    serviceName: 'Emby',
  })
}

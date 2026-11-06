import { envConfig } from '@/config/env'
import type { TargetPolicy } from '@/core/net/guarded-fetch'

/** Destination policy for Plex, Jellyfin, Emby and Subsonic, whose URLs any user can set. */
export function mediaServerTargetPolicy(): TargetPolicy {
  return envConfig.mediaServerAllowLocal ? 'local' : 'lan'
}

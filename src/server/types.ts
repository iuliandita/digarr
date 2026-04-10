import type {
  DiscoveryAvailabilityResult,
  DiscoveryConnectionSnapshot,
} from '@/core/discovery-modes/availability'

export type HonoEnv = {
  Variables: {
    userId?: number
    proxyAuth?: boolean
    sessionToken?: string
    legacyTokenAuth?: boolean
    /** True when auth middleware determined no auth is configured (no users, no legacy token). */
    authSkipped?: boolean
  }
}

export type { DiscoveryAvailabilityResult, DiscoveryConnectionSnapshot }

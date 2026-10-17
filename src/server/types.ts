import type {
  DiscoveryAvailabilityResult,
  DiscoveryConnectionSnapshot,
} from '@/core/discovery-modes/availability'

export type AuthMethod =
  | 'api-token'
  | 'session-bearer'
  | 'session-cookie'
  | 'session-query'
  | 'legacy-bearer'
  | 'legacy-query'
  | 'proxy'

export type HonoEnv = {
  Variables: {
    userId?: number
    authMethod?: AuthMethod
    apiTokenScope?: import('@/db/schema').ApiTokenScope
    proxyAuth?: boolean
    legacyTokenAuth?: boolean
    /** True when auth middleware determined no auth is configured (no users, no legacy token). */
    authSkipped?: boolean
  }
}

export type { DiscoveryAvailabilityResult, DiscoveryConnectionSnapshot }

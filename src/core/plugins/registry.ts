import type { DiscoverySource, SourceCapability } from './types'

/**
 * Every registrable listening-source id. The orchestrator uses this to emit
 * `skipped/not_configured` placeholders for sources the user has not set up.
 * Adding a new source factory REQUIRES adding its id here — enforced by
 * tests/core/plugins/source-ids.test.ts.
 */
export const LISTENING_SOURCE_IDS = [
  'listenbrainz',
  'lastfm',
  'spotify',
  'plex',
  'jellyfin',
  'emby',
  'discogs',
  'subsonic',
] as const

export class SourceRegistry {
  private sources = new Map<string, DiscoverySource>()

  register(source: DiscoverySource): void {
    this.sources.set(source.id, source)
  }

  get(id: string): DiscoverySource | undefined {
    return this.sources.get(id)
  }

  all(): DiscoverySource[] {
    return Array.from(this.sources.values())
  }

  withCapability(capability: SourceCapability): DiscoverySource[] {
    return Array.from(this.sources.values()).filter((s) => s.capabilities.includes(capability))
  }

  clear(): void {
    this.sources.clear()
  }
}

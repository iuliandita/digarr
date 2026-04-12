import { createArtistRelationshipsMode } from './modes/artist-relationships'
import { createLabelsMode } from './modes/labels'
import {
  createListenBrainzMode,
  createListenBrainzRadioModes,
  createListenBrainzTagRadioMode,
} from './modes/listenbrainz'
import { createReleaseRadarMode } from './modes/release-radar'
import { createSimilarArtistWebMode } from './modes/similar-artist-web'
import type { DiscoveryModeDefinition } from './types'

export class DiscoveryModeRegistry {
  private readonly modes = new Map<string, DiscoveryModeDefinition>()

  register(mode: DiscoveryModeDefinition): void {
    if (this.modes.has(mode.id)) {
      throw new Error(`Discovery mode '${mode.id}' is already registered`)
    }
    this.modes.set(mode.id, mode)
  }

  get(id: string): DiscoveryModeDefinition | undefined {
    return this.modes.get(id)
  }

  list(): DiscoveryModeDefinition[] {
    return [...this.modes.values()]
  }
}

export function registerDefaultDiscoveryModes(
  registry: DiscoveryModeRegistry,
): DiscoveryModeRegistry {
  registry.register(createListenBrainzMode())
  for (const mode of createListenBrainzRadioModes()) {
    registry.register(mode)
  }
  registry.register(createListenBrainzTagRadioMode())
  registry.register(createReleaseRadarMode())
  registry.register(createArtistRelationshipsMode())
  registry.register(createSimilarArtistWebMode())
  registry.register(createLabelsMode())
  return registry
}

export function createDefaultDiscoveryModeRegistry(): DiscoveryModeRegistry {
  return registerDefaultDiscoveryModes(new DiscoveryModeRegistry())
}

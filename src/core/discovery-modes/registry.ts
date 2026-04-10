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

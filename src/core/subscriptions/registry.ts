import type { SubscriptionAdapter } from './types'

export const DISCOVERY_MODE_SUBSCRIPTION_TYPE = 'discovery-mode'

export class AdapterRegistry {
  private readonly adapters = new Map<string, SubscriptionAdapter>()

  register(adapter: SubscriptionAdapter): void {
    this.adapters.set(adapter.type, adapter)
  }

  get(type: string): SubscriptionAdapter | undefined {
    return this.adapters.get(type)
  }

  getAll(): SubscriptionAdapter[] {
    return Array.from(this.adapters.values())
  }

  getTypes(): string[] {
    return Array.from(this.adapters.keys())
  }
}

import { describe, expect, it } from 'vitest'
import { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { DiscoveryModeDefinition } from '@/core/discovery-modes/types'

function makeMode(id: string): DiscoveryModeDefinition {
  return {
    id,
    label: id,
    description: `${id} description`,
    availability: 'fallback',
    easyFields: [{ key: 'limit', label: 'Limit', type: 'number', required: true }],
    advancedFields: [{ key: 'limit', label: 'Limit', type: 'number', required: true }],
    executor: async () => ({ candidates: [] }),
  }
}

describe('DiscoveryModeRegistry', () => {
  it('registers and returns discovery modes in insertion order', () => {
    const registry = new DiscoveryModeRegistry()
    registry.register(makeMode('listenbrainz'))
    registry.register(makeMode('release-radar'))

    expect(registry.get('listenbrainz')?.label).toBe('listenbrainz')
    expect(registry.list().map((mode) => mode.id)).toEqual(['listenbrainz', 'release-radar'])
  })

  it('throws when the same mode id is registered twice', () => {
    const registry = new DiscoveryModeRegistry()
    registry.register(makeMode('labels'))

    expect(() => registry.register(makeMode('labels'))).toThrow(/already registered/i)
  })
})

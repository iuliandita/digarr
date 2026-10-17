import { describe, expect, it } from 'vitest'
import { resolveTab } from '@/web/pages/settings/tabs'

describe('resolveTab', () => {
  it.each([
    [null, false, 'connections'],
    ['nonsense', true, 'connections'],
    ['targets', false, 'targets'],
    ['users', false, 'connections'],
    ['system-health', false, 'connections'],
    ['users', true, 'users'],
    ['jobs', true, 'system'],
    ['system-health', true, 'system'],
    ['system', true, 'system'],
    ['system', false, 'connections'],
    ['blocked', false, 'recommendations'],
  ] as const)('%s (admin: %s) resolves to %s', (requested, isAdmin, expected) => {
    expect(resolveTab(requested, isAdmin)).toBe(expected)
  })
})

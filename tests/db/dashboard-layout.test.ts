import { describe, expect, it } from 'vitest'
import {
  type DashboardLayout,
  DEFAULT_DASHBOARD_LAYOUT,
  mergeDashboardLayout,
} from '@/core/dashboard-layout'
import { mergePreferences } from '@/db/schema'

describe('dashboard layout preference merging', () => {
  it.each([null, undefined, {}, { dashboardLayout: { version: 999, cards: [] } }])(
    'defaults absent or invalid stored preferences: %j',
    (raw) => {
      const merged = mergePreferences(raw as Parameters<typeof mergePreferences>[0])
      expect(merged.dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT)
      merged.dashboardLayout?.cards.pop()
      expect(mergePreferences(undefined).dashboardLayout?.cards).toHaveLength(5)
    },
  )

  it('drops removed cards and duplicates, inserts missing cards at default positions, and retains custom choices', () => {
    const raw = {
      version: 1,
      showEmpty: true,
      cards: [
        { id: 'subscriptions', visible: false, size: 'large' },
        { id: 'removed', visible: true, size: 'old-size' },
        { id: 'pick', visible: false, size: 'small' },
        { id: 'subscriptions', visible: true, size: 'small' },
      ],
    }
    const expected = {
      version: 1,
      showEmpty: true,
      cards: [
        { id: 'subscriptions', visible: false, size: 'large' },
        { id: 'decisions', visible: true, size: 'medium' },
        { id: 'listening', visible: true, size: 'medium' },
        { id: 'genres', visible: true, size: 'small' },
        { id: 'pick', visible: false, size: 'small' },
      ],
    }
    expect(mergePreferences({ dashboardLayout: raw as DashboardLayout }).dashboardLayout).toEqual(
      expected,
    )
    expect(mergeDashboardLayout(raw)).toEqual(expected)
  })
})

export const TABS = [
  'connections',
  'targets',
  'recommendations',
  'schedule',
  'account',
  'auth',
  'users',
  'administration',
  'system',
] as const

export type Tab = (typeof TABS)[number]

export const ADMIN_TABS: ReadonlySet<Tab> = new Set(['auth', 'users', 'administration', 'system'])

export const TAB_GROUPS: { id: 'personal' | 'library' | 'admin'; tabs: Tab[] }[] = [
  { id: 'personal', tabs: ['account', 'recommendations'] },
  { id: 'library', tabs: ['connections', 'targets', 'schedule'] },
  { id: 'admin', tabs: ['auth', 'users', 'administration', 'system'] },
]

/** Blocked used to be its own tab; old links land on its section in Recommendations. */
export const LEGACY_BLOCKED_TAB = 'blocked'

/** Unknown tabs, and admin tabs for non-admins, fall back to Connections. */
export function resolveTab(requested: string | null, isAdmin: boolean): Tab {
  const name =
    requested === LEGACY_BLOCKED_TAB
      ? 'recommendations'
      : requested === 'jobs' || requested === 'system-health'
        ? 'system'
        : requested
  const tab = TABS.find((candidate) => candidate === name)
  if (!tab || (ADMIN_TABS.has(tab) && !isAdmin)) return 'connections'
  return tab
}

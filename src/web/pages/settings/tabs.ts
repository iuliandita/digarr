export const TABS = [
  'connections',
  'targets',
  'recommendations',
  'blocked',
  'schedule',
  'account',
  'auth',
  'users',
  'administration',
  'jobs',
  'system-health',
] as const

export type Tab = (typeof TABS)[number]

export const ADMIN_TABS: ReadonlySet<Tab> = new Set([
  'schedule',
  'auth',
  'users',
  'administration',
  'jobs',
  'system-health',
])

export const TAB_GROUPS: { id: 'personal' | 'library' | 'admin'; tabs: Tab[] }[] = [
  { id: 'personal', tabs: ['account', 'recommendations', 'blocked'] },
  { id: 'library', tabs: ['connections', 'targets', 'schedule'] },
  { id: 'admin', tabs: ['auth', 'users', 'administration', 'jobs', 'system-health'] },
]

/** Unknown tabs, and admin tabs for non-admins, fall back to Connections. */
export function resolveTab(requested: string | null, isAdmin: boolean): Tab {
  const tab = TABS.find((candidate) => candidate === requested)
  if (!tab || (ADMIN_TABS.has(tab) && !isAdmin)) return 'connections'
  return tab
}

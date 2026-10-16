import {
  BarChart3,
  CalendarClock,
  Compass,
  HeartPulse,
  History,
  LayoutDashboard,
  ListMusic,
  type LucideIcon,
  RefreshCw,
  Search,
} from 'lucide-react'
import type { MessageKey } from '@/core/i18n/messages/types'

type Location = { pathname: string; search: string }

export type NavItem = {
  to: string
  labelKey: MessageKey
  icon: LucideIcon
  isActive: (location: Location) => boolean
}

function under(prefix: string) {
  return ({ pathname }: Location) => pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function settingsTab({ pathname, search }: Location) {
  return pathname === '/settings' ? new URLSearchParams(search).get('tab') : null
}

export const PRIMARY_NAV: NavItem[] = [
  {
    to: '/',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    isActive: ({ pathname }) => pathname === '/',
  },
  {
    to: '/discover',
    labelKey: 'nav.discover',
    icon: Compass,
    isActive: (location) => under('/discover')(location) || under('/genres')(location),
  },
  { to: '/search', labelKey: 'nav.search', icon: Search, isActive: under('/search') },
  { to: '/playlists', labelKey: 'nav.playlists', icon: ListMusic, isActive: under('/playlists') },
  {
    to: '/subscriptions',
    labelKey: 'nav.subscriptions',
    icon: CalendarClock,
    isActive: under('/subscriptions'),
  },
]

// Admin-only; the server enforces access, this only controls what the nav offers.
export const TOOLS_NAV: NavItem[] = [
  {
    to: '/library/health',
    labelKey: 'nav.health',
    icon: HeartPulse,
    isActive: under('/library/health'),
  },
  {
    to: '/library/reconciliation',
    labelKey: 'nav.reconciliation',
    icon: RefreshCw,
    isActive: under('/library/reconciliation'),
  },
  { to: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, isActive: under('/analytics') },
  {
    to: '/settings?tab=jobs',
    labelKey: 'jobHistory.title',
    icon: History,
    isActive: (location) => settingsTab(location) === 'jobs',
  },
]

export const DISCOVER_TABS: Omit<NavItem, 'icon'>[] = [
  {
    to: '/discover',
    labelKey: 'nav.recommendations',
    isActive: ({ pathname }) => pathname === '/discover',
  },
  { to: '/genres', labelKey: 'nav.genres', isActive: under('/genres') },
  {
    to: '/discover/modes',
    labelKey: 'nav.discoveryModes',
    isActive: under('/discover/modes'),
  },
]

export function isSettingsActive(location: Location): boolean {
  return (
    (location.pathname === '/settings' && settingsTab(location) !== 'jobs') ||
    location.pathname === '/users'
  )
}

import {
  BarChart3,
  Compass,
  HeartPulse,
  History,
  LayoutDashboard,
  ListMusic,
  type LucideIcon,
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
    isActive: (location) =>
      under('/discover')(location) ||
      under('/discovery-modes')(location) ||
      under('/genres')(location),
  },
  { to: '/search', labelKey: 'nav.search', icon: Search, isActive: under('/search') },
  { to: '/playlists', labelKey: 'nav.playlists', icon: ListMusic, isActive: under('/playlists') },
]

// Admin-only; the server enforces access, this only controls what the nav offers.
export const TOOLS_NAV: NavItem[] = [
  {
    to: '/library?tab=health',
    labelKey: 'nav.library',
    icon: HeartPulse,
    isActive: under('/library'),
  },
  { to: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, isActive: under('/analytics') },
  {
    to: '/settings?tab=system#jobs',
    labelKey: 'jobHistory.title',
    icon: History,
    isActive: (location) => settingsTab(location) === 'system',
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
    to: '/discovery-modes',
    labelKey: 'nav.discoveryModes',
    isActive: under('/discovery-modes'),
  },
]

export function isSettingsActive(location: Location): boolean {
  return (
    (location.pathname === '/settings' && settingsTab(location) !== 'system') ||
    location.pathname === '/users'
  )
}

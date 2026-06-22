import { Compass, Disc3, LayoutDashboard, Music, Search, Settings } from 'lucide-react'
import { NavLink, useLocation, useSearchParams } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

// BottomNav

/**
 * Mobile-only bottom navigation bar. Hidden on md+ breakpoints.
 * Fixed to bottom of screen, above any content via z-index.
 */
export function BottomNav() {
  const { t } = useI18n()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const kind = searchParams.get('kind')

  // The Discover and Albums entries share the /discover pathname and differ only
  // by the ?kind=album search param, so NavLink's pathname-only isActive would
  // light up both. Compute their active state explicitly off the search param.
  const onDiscover = location.pathname === '/discover'
  const albumsActive = onDiscover && kind === 'album'
  const discoverActive = onDiscover && kind !== 'album'

  // `isActive` is the active state from NavLink (pathname-based); `override`,
  // when provided, replaces it for the search-param-aware Discover/Albums pair.
  const items: Array<{
    to: string
    label: string
    Icon: typeof LayoutDashboard
    exact: boolean
    override?: boolean
  }> = [
    { to: '/', label: t('nav.dashboard'), Icon: LayoutDashboard, exact: true },
    {
      to: '/discover',
      label: t('nav.discover'),
      Icon: Compass,
      exact: true,
      override: discoverActive,
    },
    {
      to: '/discover?kind=album',
      label: t('nav.albums'),
      Icon: Disc3,
      exact: false,
      override: albumsActive,
    },
    { to: '/search', label: t('nav.search'), Icon: Search, exact: false },
    { to: '/genres', label: t('nav.genres'), Icon: Music, exact: false },
    { to: '/settings', label: t('nav.settings'), Icon: Settings, exact: false },
  ]
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg border-t border-border"
      aria-label={t('app.mobileNav')}
    >
      <div className="flex items-center justify-around h-14 px-2">
        {items.map(({ to, label, Icon, exact, override }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => {
              const active = override ?? isActive
              return cn(
                'flex min-h-11 min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                active ? 'text-accent' : 'text-muted hover:text-text',
              )
            }}
            aria-label={label}
          >
            {({ isActive }) => {
              const active = override ?? isActive
              return (
                <>
                  <Icon
                    size={20}
                    aria-hidden="true"
                    className={active ? 'text-accent' : undefined}
                  />
                  <span className="text-micro font-medium leading-none">{label}</span>
                </>
              )
            }}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

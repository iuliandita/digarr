import { Compass, LayoutDashboard, Music, Search, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

// BottomNav

/**
 * Mobile-only bottom navigation bar. Hidden on md+ breakpoints.
 * Fixed to bottom of screen, above any content via z-index.
 */
export function BottomNav() {
  const { t } = useI18n()
  const items = [
    { to: '/', label: t('nav.dashboard'), Icon: LayoutDashboard, exact: true },
    { to: '/discover', label: t('nav.discover'), Icon: Compass, exact: false },
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
        {items.map(({ to, label, Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                isActive ? 'text-accent' : 'text-muted hover:text-text',
              )
            }
            aria-label={label}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  aria-hidden="true"
                  className={isActive ? 'text-accent' : undefined}
                />
                <span className="text-micro font-medium leading-none">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { PRIMARY_NAV } from '../lib/nav'
import { cn } from '../lib/utils'

/** Mobile-only bottom navigation for the daily pages. Hidden from the md breakpoint up. */
export function BottomNav() {
  const { t } = useI18n()
  const location = useLocation()
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label={t('app.mobileNav')}
    >
      <ul className="flex h-14 items-stretch justify-around px-1">
        {PRIMARY_NAV.map((item) => {
          const active = item.isActive(location)
          return (
            <li key={item.to} className="flex min-w-0 flex-1">
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-control px-0.5 transition-colors focus-ring',
                  active ? 'text-accent' : 'text-muted hover:text-text',
                )}
              >
                <item.icon size={20} aria-hidden="true" />
                {/* Wrap to two lines instead of truncating long labels (de, ja). */}
                <span className="line-clamp-2 w-full hyphens-auto break-words text-center text-micro leading-tight font-medium [font-stretch:85%]">
                  {t(item.labelKey)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

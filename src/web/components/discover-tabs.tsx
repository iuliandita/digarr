import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { DISCOVER_TABS } from '../lib/nav'
import { cn } from '../lib/utils'

export function DiscoverTabs({ className }: { className?: string }) {
  const { t } = useI18n()
  const location = useLocation()
  return (
    <nav aria-label={t('nav.discover')} className={cn('border-b border-border', className)}>
      <ul className="scroll-fade-x -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {DISCOVER_TABS.map((tab) => {
          const active = tab.isActive(location)
          return (
            <li key={tab.to} className="shrink-0">
              <Link
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 px-3 text-body font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-10',
                  active
                    ? 'border-accent text-text'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t(tab.labelKey)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

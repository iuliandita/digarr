import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/ui/page-header'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'
import { LibraryHealthPage } from './library-health'
import { LibraryReconciliationPage } from './library-reconciliation'

export function LibraryPage() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'reconciliation' ? 'reconciliation' : 'health'

  if (pathname === '/library/health' || pathname === '/library/reconciliation') {
    return <Navigate to={`/library?tab=${pathname.split('/').at(-1)}`} replace />
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title={t('nav.library')} />
      <nav aria-label={t('nav.library')} className="border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {(['health', 'reconciliation'] as const).map((key) => (
            <li key={key} className="shrink-0">
              <Link
                to={`/library?tab=${key}`}
                aria-current={tab === key ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 px-3 text-body font-medium transition-colors focus-ring',
                  tab === key
                    ? 'border-accent text-text'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t(key === 'health' ? 'nav.health' : 'nav.reconciliation')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'health' ? <LibraryHealthPage /> : <LibraryReconciliationPage />}
    </div>
  )
}

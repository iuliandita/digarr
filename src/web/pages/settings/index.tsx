import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { OAuthCallbackNotice } from '../../components/oauth-callback-notice'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page-header'
import { Skeleton } from '../../components/ui/skeleton'
import { getCurrentUser, getSettings } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { SettingsNav } from './settings-nav'
import { LEGACY_BLOCKED_TAB, resolveTab, type Tab } from './tabs'

const AdministrationTab = lazy(() =>
  import('../../components/admin/administration-tab').then((m) => ({
    default: m.AdministrationTab,
  })),
)
const UserManagementPage = lazy(() =>
  import('../user-management').then((m) => ({ default: m.UserManagementPage })),
)
const AccountTab = lazy(() => import('./account-tab').then((m) => ({ default: m.AccountTab })))
const AuthTab = lazy(() => import('./auth-tab').then((m) => ({ default: m.AuthTab })))
const ConnectionsTab = lazy(() =>
  import('./connections-tab').then((m) => ({ default: m.ConnectionsTab })),
)
const RecommendationsTab = lazy(() =>
  import('./recommendations-tab').then((m) => ({ default: m.RecommendationsTab })),
)
const ScheduleTab = lazy(() => import('./schedule-tab').then((m) => ({ default: m.ScheduleTab })))
const SystemTab = lazy(() => import('./system-tab').then((m) => ({ default: m.SystemTab })))
const TargetsTab = lazy(() => import('./targets-tab').then((m) => ({ default: m.TargetsTab })))

function SettingsSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-[13.75rem_minmax(0,1fr)]">
      <div className="hidden space-y-2 md:block">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-surface" />
        ))}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: currentUser, isPending: userPending } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  })
  const isAdmin = currentUser?.isAdmin ?? false
  // Resolve only once the role is known, or admin deep links would fall back while it loads
  const requestedTab = searchParams.get('tab')
  const tab = resolveTab(requestedTab, isAdmin)
  // Keep the URL honest when a link names a tab this user can't open
  useEffect(() => {
    if (userPending || requestedTab === null || requestedTab === tab) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', tab)
    const legacyHash =
      requestedTab === LEGACY_BLOCKED_TAB
        ? '#blocked'
        : tab === 'system' && requestedTab === 'jobs'
          ? '#jobs'
          : tab === 'system' && requestedTab === 'system-health'
            ? '#health'
            : null
    if (legacyHash) {
      navigate(
        { pathname: location.pathname, search: nextParams.toString(), hash: legacyHash },
        { replace: true },
      )
      return
    }
    setSearchParams(nextParams, { replace: true })
  }, [userPending, requestedTab, tab, searchParams, setSearchParams, navigate, location.pathname])
  const {
    data,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  function handleTabChange(nextTab: Tab) {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', nextTab)
    setSearchParams(nextParams, { replace: true })
  }

  if (loading || userPending) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <PageHeader title={t('settings.title')} />
        <SettingsSkeleton />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-reject">
        <p>
          {t('errorBoundary.title')}: {error?.message ?? t('common.unknownError')}
        </p>
        <Button variant="outline" size="sm" onClick={refetch} className="mt-3">
          {t('errorBoundary.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title={t('settings.title')} />
      <OAuthCallbackNotice />
      <div className="grid gap-6 md:grid-cols-[13.75rem_minmax(0,1fr)]">
        <SettingsNav active={tab} onChange={handleTabChange} isAdmin={isAdmin} />
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-surface" />}>
            {tab === 'connections' && <ConnectionsTab settings={data} onSaved={refetch} />}
            {tab === 'targets' && <TargetsTab />}
            {tab === 'recommendations' && <RecommendationsTab />}
            {tab === 'schedule' && (
              <ScheduleTab settings={data} onSaved={refetch} isAdmin={isAdmin} />
            )}
            {tab === 'account' && <AccountTab />}
            {tab === 'auth' && <AuthTab settings={data} onSaved={refetch} />}
            {tab === 'users' && <UserManagementPage embedded />}
            {tab === 'administration' && <AdministrationTab />}
            {tab === 'system' && <SystemTab />}
          </Suspense>
        </div>
      </div>
    </div>
  )
}

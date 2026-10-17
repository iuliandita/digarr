import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdministrationTab } from '../../components/admin/administration-tab'
import { BlockedAlbumsTab } from '../../components/blocked-albums-tab'
import { BlockedArtistsTab } from '../../components/blocked-artists-tab'
import { OAuthCallbackNotice } from '../../components/oauth-callback-notice'
import { SystemHealthCard } from '../../components/system-health-card'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page-header'
import { Skeleton } from '../../components/ui/skeleton'
import { getCurrentUser, getSettings } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import JobHistoryPage from '../job-history'
import { UserManagementPage } from '../user-management'
import { AccountTab } from './account-tab'
import { AuthTab } from './auth-tab'
import { ConnectionsTab } from './connections-tab'
import { RecommendationsTab } from './recommendations-tab'
import { ScheduleTab } from './schedule-tab'
import { SettingsNav } from './settings-nav'
import { resolveTab, type Tab } from './tabs'
import { TargetsTab } from './targets-tab'

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
    setSearchParams(nextParams, { replace: true })
  }, [userPending, requestedTab, tab, searchParams, setSearchParams])
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
          {tab === 'connections' && <ConnectionsTab settings={data} onSaved={refetch} />}
          {tab === 'targets' && <TargetsTab />}
          {tab === 'recommendations' && <RecommendationsTab isAdmin={isAdmin} />}
          {tab === 'blocked' && (
            <div className="space-y-8">
              <BlockedArtistsTab />
              <BlockedAlbumsTab />
            </div>
          )}
          {tab === 'schedule' && <ScheduleTab settings={data} />}
          {tab === 'account' && <AccountTab />}
          {tab === 'auth' && <AuthTab settings={data} onSaved={refetch} />}
          {tab === 'users' && <UserManagementPage embedded />}
          {tab === 'administration' && <AdministrationTab />}
          {tab === 'jobs' && <JobHistoryPage embedded />}
          {tab === 'system-health' && <SystemHealthCard embedded />}
        </div>
      </div>
    </div>
  )
}

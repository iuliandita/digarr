import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { type DashboardLayout, mergeDashboardLayout } from '@/core/dashboard-layout'
import { getUserPreferences, updateUserPreferences } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function useDashboardLayout() {
  const client = useQueryClient()
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
    staleTime: 60_000,
  })
  const mutation = useMutation({
    mutationKey: ['dashboard-layout'],
    mutationFn: ({ layout }: { layout: DashboardLayout; previous: unknown }) =>
      updateUserPreferences({ dashboardLayout: layout }),
    onError: (_, { previous }) => {
      client.setQueryData(['user-preferences'], (old: Record<string, unknown> | undefined) => ({
        ...old,
        dashboardLayout: previous,
      }))
      toast.error(t('dashboard.layoutSaveFailed'))
    },
  })
  return {
    layout: mergeDashboardLayout(query.data?.dashboardLayout),
    disabled: !query.isSuccess || mutation.isPending,
    error: query.isError,
    retry: () => {
      void query.refetch()
    },
    save: (layout: DashboardLayout) => {
      if (!query.isSuccess || mutation.isPending) return
      void client.cancelQueries({ queryKey: ['user-preferences'] })
      const previous = client.getQueryData<Record<string, unknown>>([
        'user-preferences',
      ])?.dashboardLayout
      client.setQueryData(['user-preferences'], (old: Record<string, unknown> | undefined) => ({
        ...old,
        dashboardLayout: layout,
      }))
      mutation.mutate({ layout, previous })
    },
  }
}

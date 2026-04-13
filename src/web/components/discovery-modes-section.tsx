import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { getDiscoveryModes, getJob, runDiscoveryMode } from '../lib/api'
import { waitForDiscoveryRunCompletion } from '../lib/discovery-run-feedback'
import { useI18n } from '../lib/i18n'
import { DiscoveryModeCard } from './discovery-mode-card'

export function DiscoveryModesSection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: discoveryModes } = useQuery({
    queryKey: ['discovery-modes'],
    queryFn: getDiscoveryModes,
    staleTime: 60_000,
  })

  const refreshRecommendations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
  }, [queryClient])

  const handleRunDiscoveryMode = useCallback(
    async (body: Record<string, unknown>) => {
      const result = await runDiscoveryMode(body)
      toast.success(t('discover.discoveryRunStarted'))
      if (typeof result.jobId === 'number') {
        void waitForDiscoveryRunCompletion(result.jobId, {
          getJob,
          onCompleted: refreshRecommendations,
          onFailed: (job) => {
            toast.error(job.error ?? t('common.failed'))
          },
        })
      }
      refreshRecommendations()
    },
    [refreshRecommendations, t],
  )

  if (!discoveryModes || discoveryModes.modes.length === 0) {
    return null
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {discoveryModes.modes.map((mode) => (
          <DiscoveryModeCard key={mode.id} mode={mode} onRun={handleRunDiscoveryMode} />
        ))}
      </div>
    </section>
  )
}

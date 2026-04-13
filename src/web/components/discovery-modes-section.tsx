import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getDiscoveryModes, runDiscoveryMode } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { DiscoveryModeCard } from './discovery-mode-card'

export function DiscoveryModesSection() {
  const { t } = useI18n()
  const { data: discoveryModes } = useQuery({
    queryKey: ['discovery-modes'],
    queryFn: getDiscoveryModes,
    staleTime: 60_000,
  })

  async function handleRunDiscoveryMode(body: Record<string, unknown>) {
    await runDiscoveryMode(body)
    toast.success(t('discover.discoveryRunStarted'))
  }

  if (!discoveryModes?.modes.length) return null

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

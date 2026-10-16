import { useSearchParams } from 'react-router-dom'
import { DiscoverTabs } from '../components/discover-tabs'
import { DiscoveryModesSection } from '../components/discovery-modes-section'
import { PageHeader } from '../components/ui/page-header'
import { useI18n } from '../lib/i18n'

export function DiscoveryModesPage() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const requestedModeId = searchParams.get('mode')

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-4 sm:p-6">
      <DiscoverTabs />
      <PageHeader
        title={t('discover.discoveryModes')}
        description={t('discover.discoveryModesDescription')}
      />

      <DiscoveryModesSection requestedModeId={requestedModeId} />
    </div>
  )
}

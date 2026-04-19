import { Link } from 'react-router-dom'
import { DiscoveryModesSection } from '../components/discovery-modes-section'
import { useI18n } from '../lib/i18n'

export function DiscoveryModesPage() {
  const { t } = useI18n()

  return (
    <div className="max-w-6xl mx-auto space-y-6 px-6 py-6">
      <div className="space-y-3">
        <Link to="/discover" className="text-sm text-accent underline">
          {t('nav.recommendations')}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">{t('discover.discoveryModes')}</h1>
          <p className="text-sm text-muted">{t('discover.discoveryModesDescription')}</p>
        </div>
      </div>

      <DiscoveryModesSection />
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { IntegrationHealthCard } from '../../components/integration-health-card'
import { SystemHealthCard } from '../../components/system-health-card'
import { useI18n } from '../../lib/i18n'
import JobHistoryPage from '../job-history'

export function SystemTab() {
  const { t } = useI18n()
  const { hash } = useLocation()
  const jobsRef = useRef<HTMLElement>(null)
  const healthRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const section =
      hash === '#jobs' ? jobsRef.current : hash === '#health' ? healthRef.current : null
    section?.scrollIntoView?.({ block: 'start' })
    section?.focus({ preventScroll: true })
  }, [hash])

  return (
    <div className="space-y-8">
      <section
        id="jobs"
        ref={jobsRef}
        tabIndex={-1}
        aria-label={t('jobHistory.title')}
        className="scroll-mt-4"
      >
        <JobHistoryPage embedded />
      </section>
      <section
        id="health"
        ref={healthRef}
        tabIndex={-1}
        aria-label={t('systemHealth.title')}
        className="scroll-mt-4"
      >
        <div className="space-y-6">
          <SystemHealthCard embedded />
          <IntegrationHealthCard />
        </div>
      </section>
    </div>
  )
}

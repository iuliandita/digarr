import { Disclosure } from '@/web/components/ui/disclosure'
import { useI18n } from '@/web/lib/i18n'
import { BackupSection } from './backup-section'
import { HygieneSection } from './hygiene-section'
import { MigrateBackendSection } from './migrate-backend-section'
import { UpgradeSection } from './upgrade-section'

export function AdministrationTab() {
  const { t } = useI18n()

  return (
    <div className="space-y-4 max-w-lg">
      <Disclosure title={t('admin.backupRestore')} defaultOpen>
        <BackupSection />
      </Disclosure>

      <Disclosure title={t('admin.migrateBackend')}>
        <MigrateBackendSection />
      </Disclosure>

      <Disclosure title={t('admin.dataHygiene')}>
        <HygieneSection />
      </Disclosure>

      <Disclosure title={t('admin.upgradeInfo')}>
        <UpgradeSection />
      </Disclosure>
    </div>
  )
}

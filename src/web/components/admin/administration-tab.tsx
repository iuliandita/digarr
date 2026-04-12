import { CollapsibleSection } from '@/web/components/collapsible-section'
import { useI18n } from '@/web/lib/i18n'
import { BackupSection } from './backup-section'
import { HygieneSection } from './hygiene-section'
import { UpgradeSection } from './upgrade-section'

export function AdministrationTab() {
  const { t } = useI18n()

  return (
    <div className="space-y-4 max-w-lg">
      <CollapsibleSection title={t('admin.backupRestore')} defaultOpen>
        <BackupSection />
      </CollapsibleSection>

      <CollapsibleSection title={t('admin.dataHygiene')}>
        <HygieneSection />
      </CollapsibleSection>

      <CollapsibleSection title={t('admin.upgradeInfo')}>
        <UpgradeSection />
      </CollapsibleSection>
    </div>
  )
}

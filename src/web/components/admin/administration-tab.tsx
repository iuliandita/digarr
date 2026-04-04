import { CollapsibleSection } from '@/web/components/collapsible-section'
import { BackupSection } from './backup-section'
import { HygieneSection } from './hygiene-section'
import { UpgradeSection } from './upgrade-section'

export function AdministrationTab() {
  return (
    <div className="space-y-4 max-w-lg">
      <CollapsibleSection title="Backup & Restore" defaultOpen>
        <BackupSection />
      </CollapsibleSection>

      <CollapsibleSection title="Data Hygiene">
        <HygieneSection />
      </CollapsibleSection>

      <CollapsibleSection title="Upgrade Info">
        <UpgradeSection />
      </CollapsibleSection>
    </div>
  )
}

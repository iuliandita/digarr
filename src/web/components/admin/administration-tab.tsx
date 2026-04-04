import { useState } from 'react'
import { BackupSection } from './backup-section'
import { HygieneSection } from './hygiene-section'
import { UpgradeSection } from './upgrade-section'

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between p-4 text-text font-medium text-sm hover:bg-surface transition-colors rounded-lg"
      >
        {title}
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

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

import type { MessageKey } from '@/core/i18n/messages/types'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { ADMIN_TABS, TAB_GROUPS, type Tab } from './tabs'

const TAB_LABELS: Record<Tab, MessageKey> = {
  connections: 'settings.tabs.connections',
  targets: 'settings.tabs.targets',
  recommendations: 'settings.tabs.recommendations',
  blocked: 'settings.tabs.blocked',
  schedule: 'settings.tabs.schedule',
  account: 'settings.tabs.account',
  auth: 'settings.tabs.authentication',
  users: 'settings.tabs.users',
  administration: 'settings.tabs.administration',
  jobs: 'settings.tabs.jobHistory',
  'system-health': 'settings.tabs.systemHealth',
}

const GROUP_LABELS: Record<(typeof TAB_GROUPS)[number]['id'], MessageKey> = {
  personal: 'settings.groups.personal',
  library: 'settings.groups.library',
  admin: 'settings.groups.admin',
}

/** Grouped side menu on desktop, grouped select on small screens. */
export function SettingsNav({
  active,
  onChange,
  isAdmin,
}: {
  active: Tab
  onChange: (tab: Tab) => void
  isAdmin: boolean
}) {
  const { t } = useI18n()
  const groups = TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => isAdmin || !ADMIN_TABS.has(tab)),
  })).filter((group) => group.tabs.length > 0)

  return (
    <>
      <div className="md:hidden">
        <Select
          aria-label={t('settings.title')}
          value={active}
          onChange={(e) => onChange(e.target.value as Tab)}
          data-testid="settings-section-select"
        >
          {groups.map((group) => (
            <optgroup key={group.id} label={t(GROUP_LABELS[group.id])}>
              {group.tabs.map((tab) => (
                <option key={tab} value={tab}>
                  {t(TAB_LABELS[tab])}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <nav aria-label={t('settings.title')} className="hidden md:block">
        <div className="sticky top-4 space-y-5">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="px-3 pb-1 text-caption text-muted">{t(GROUP_LABELS[group.id])}</p>
              <ul className="space-y-0.5">
                {group.tabs.map((tab) => (
                  <li key={tab}>
                    <button
                      type="button"
                      data-settings-tab={tab}
                      aria-current={active === tab ? 'page' : undefined}
                      onClick={() => onChange(tab)}
                      className={cn(
                        'w-full rounded-control px-3 py-1.5 text-left text-body transition-colors focus-ring',
                        active === tab
                          ? 'bg-surface-2 font-medium text-text'
                          : 'text-muted hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      {t(TAB_LABELS[tab])}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  )
}

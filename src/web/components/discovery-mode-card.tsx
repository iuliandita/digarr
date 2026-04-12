import type { MessageKey } from '@/core/i18n/messages/types'
import type { DiscoveryModeResponse } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { DiscoveryModeForm } from './discovery-mode-form'
import { DiscoveryModeInfoBox } from './discovery-mode-info-box'

export function DiscoveryModeCard({
  mode,
  onRun,
}: {
  mode: DiscoveryModeResponse
  onRun: (body: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useI18n()

  // Try i18n key for mode label/description, fall back to API string
  const labelKey = `discoveryMode.${mode.id}.label` as MessageKey
  const descKey = `discoveryMode.${mode.id}.description` as MessageKey
  const modeLabel = t(labelKey) !== labelKey ? t(labelKey) : mode.label
  const modeDescription = t(descKey) !== descKey ? t(descKey) : mode.description

  return (
    <article className="space-y-4 rounded-xl border border-border bg-bg p-5 shadow-sm">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-text">{modeLabel}</h3>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              mode.availability.enabled
                ? 'bg-approve/15 text-approve'
                : 'bg-surface text-muted border border-border'
            }`}
          >
            {mode.availability.enabled
              ? t('discoveryMode.available')
              : t('discoveryMode.unavailable')}
          </span>
        </div>
        <p className="text-sm text-muted">{modeDescription}</p>
      </div>

      {!mode.availability.enabled && mode.availability.reason && (
        <DiscoveryModeInfoBox storageKey={`digarr:discovery-mode:${mode.id}:availability`}>
          {mode.availability.reason === 'This mode is not shipped yet.'
            ? t('discoveryMode.notShippedYet')
            : mode.availability.reason}
        </DiscoveryModeInfoBox>
      )}

      {mode.availability.enabled && mode.availability.fallbackUsed && mode.availability.reason && (
        <DiscoveryModeInfoBox storageKey={`digarr:discovery-mode:${mode.id}:fallback`}>
          {mode.availability.reason}
        </DiscoveryModeInfoBox>
      )}

      <DiscoveryModeForm mode={mode} onRun={onRun} />
    </article>
  )
}

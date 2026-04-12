import type { DiscoveryModeResponse } from '../lib/api'
import {
  translateDiscoveryModeDescription,
  translateDiscoveryModeLabel,
  translateDiscoveryReason,
} from '../lib/discovery-i18n'
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
  const modeLabel = translateDiscoveryModeLabel(t, mode)
  const modeDescription = translateDiscoveryModeDescription(t, mode)
  const availabilityReason = translateDiscoveryReason(t, mode.availability.reason)

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

      {!mode.availability.enabled && availabilityReason && (
        <DiscoveryModeInfoBox storageKey={`digarr:discovery-mode:${mode.id}:availability`}>
          {availabilityReason}
        </DiscoveryModeInfoBox>
      )}

      {mode.availability.enabled && mode.availability.fallbackUsed && availabilityReason && (
        <DiscoveryModeInfoBox storageKey={`digarr:discovery-mode:${mode.id}:fallback`}>
          {availabilityReason}
        </DiscoveryModeInfoBox>
      )}

      <DiscoveryModeForm mode={mode} onRun={onRun} />
    </article>
  )
}

import type { DiscoveryModeResponse } from '../lib/api'
import { DiscoveryModeForm } from './discovery-mode-form'
import { DiscoveryModeInfoBox } from './discovery-mode-info-box'

export function DiscoveryModeCard({
  mode,
  onRun,
}: {
  mode: DiscoveryModeResponse
  onRun: (body: Record<string, unknown>) => Promise<void>
}) {
  return (
    <article className="space-y-4 rounded-xl border border-border bg-bg p-5 shadow-sm">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-text">{mode.label}</h3>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              mode.availability.enabled
                ? 'bg-approve/15 text-approve'
                : 'bg-surface text-muted border border-border'
            }`}
          >
            {mode.availability.enabled ? 'Available' : 'Unavailable'}
          </span>
        </div>
        <p className="text-sm text-muted">{mode.description}</p>
      </div>

      {!mode.availability.enabled && mode.availability.reason && (
        <DiscoveryModeInfoBox storageKey={`digarr:discovery-mode:${mode.id}:availability`}>
          {mode.availability.reason}
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

import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '@/web/lib/i18n'
import { createSubscriptionApi, updateSettings } from '../lib/api'

type Props = {
  connectedServices: string[] // e.g. ['spotify', 'lastfm', 'listenbrainz']
  onComplete: () => void
  onCustom: () => void
}

type PresetId = 'casual' | 'deep-diver' | 'ai-only' | 'custom'

type Preset = {
  id: PresetId
  icon: string
  titleKey: MessageKey
  descriptionKey: MessageKey
  requiresCount?: number
  requiresLabelKey?: MessageKey
}

const PRESETS: Preset[] = [
  {
    id: 'casual',
    icon: '🎵',
    titleKey: 'subscriptionPresets.casualTitle',
    descriptionKey: 'subscriptionPresets.casualDescription',
    requiresCount: 1,
    requiresLabelKey: 'subscriptionPresets.oneConnectedService',
  },
  {
    id: 'deep-diver',
    icon: '🔍',
    titleKey: 'subscriptionPresets.deepDiverTitle',
    descriptionKey: 'subscriptionPresets.deepDiverDescription',
    requiresCount: 2,
    requiresLabelKey: 'subscriptionPresets.twoConnectedServices',
  },
  {
    id: 'ai-only',
    icon: '🎯',
    titleKey: 'subscriptionPresets.discoveryOnlyTitle',
    descriptionKey: 'subscriptionPresets.discoveryOnlyDescription',
  },
  {
    id: 'custom',
    icon: '⚙️',
    titleKey: 'subscriptionPresets.customTitle',
    descriptionKey: 'subscriptionPresets.customDescription',
  },
]

export function SubscriptionPresets({ connectedServices, onComplete, onCustom }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState<PresetId | null>(null)

  const serviceCount = connectedServices.length

  async function handleCasual() {
    setLoading('casual')
    try {
      const subs: Promise<unknown>[] = []

      if (connectedServices.includes('spotify')) {
        subs.push(
          createSubscriptionApi({
            name: 'Spotify Top 50 Global',
            sourceType: 'spotify-charts',
            sourceProvider: 'spotify',
            sourceConfig: { region: 'global', chartType: 'top50' },
            cron: '0 6 * * 1',
            maxArtistsPerRun: 20,
            action: 'add_to_recommendations',
          }),
        )
      }

      if (connectedServices.includes('lastfm')) {
        subs.push(
          createSubscriptionApi({
            name: 'Last.fm Top Genre',
            sourceType: 'lastfm-tag',
            sourceProvider: 'lastfm',
            sourceConfig: { tag: 'electronic' },
            cron: '0 6 * * 1',
            maxArtistsPerRun: 20,
            action: 'add_to_recommendations',
          }),
        )
      }

      if (subs.length === 0) {
        // Fallback: create a listenbrainz-based sub if connected
        if (connectedServices.includes('listenbrainz')) {
          await createSubscriptionApi({
            name: 'ListenBrainz Weekly Jams',
            sourceType: 'listenbrainz',
            sourceProvider: 'listenbrainz',
            sourceConfig: { feedType: 'weekly-jams' },
            cron: '0 6 * * 1',
            maxArtistsPerRun: 20,
            action: 'add_to_recommendations',
          })
        }
      } else {
        await Promise.all(subs)
      }

      toast.success(t('subscriptionPresets.casualApplied'))
      onComplete()
    } catch {
      toast.error(t('subscriptionPresets.applyFailed'))
    } finally {
      setLoading(null)
    }
  }

  async function handleDeepDiver() {
    setLoading('deep-diver')
    try {
      const subs: Promise<unknown>[] = []

      if (connectedServices.includes('spotify')) {
        subs.push(
          createSubscriptionApi({
            name: 'Spotify Top 50 Global',
            sourceType: 'spotify-charts',
            sourceProvider: 'spotify',
            sourceConfig: { region: 'global', chartType: 'top50' },
            cron: '0 6 * * *',
            maxArtistsPerRun: 30,
            action: 'add_to_recommendations',
          }),
        )
      }

      if (connectedServices.includes('lastfm')) {
        subs.push(
          createSubscriptionApi({
            name: 'Last.fm Charts',
            sourceType: 'lastfm-charts',
            sourceProvider: 'lastfm',
            sourceConfig: {},
            cron: '0 6 * * *',
            maxArtistsPerRun: 30,
            action: 'add_to_recommendations',
          }),
        )
      }

      if (connectedServices.includes('listenbrainz')) {
        subs.push(
          createSubscriptionApi({
            name: 'ListenBrainz Fresh Releases',
            sourceType: 'listenbrainz',
            sourceProvider: 'listenbrainz',
            sourceConfig: { feedType: 'fresh-releases' },
            cron: '0 6 * * *',
            maxArtistsPerRun: 30,
            action: 'add_to_recommendations',
          }),
        )
      }

      await Promise.all(subs)
      toast.success(t('subscriptionPresets.deepDiverApplied'))
      onComplete()
    } catch {
      toast.error(t('subscriptionPresets.applyFailed'))
    } finally {
      setLoading(null)
    }
  }

  async function handleAiOnly() {
    setLoading('ai-only')
    try {
      await updateSettings({ preferences: { subscriptionMode: 'ai-only' } })
      toast.success(t('subscriptionPresets.aiOnlyEnabled'))
      onComplete()
    } catch {
      toast.error(t('subscriptionPresets.aiOnlyEnableFailed'))
    } finally {
      setLoading(null)
    }
  }

  function isDisabled(preset: Preset): boolean {
    if (loading !== null) return true
    if (preset.requiresCount !== undefined && serviceCount < preset.requiresCount) return true
    return false
  }

  function getDisabledReason(preset: Preset): string | null {
    if (
      preset.requiresCount !== undefined &&
      preset.requiresLabelKey &&
      serviceCount < preset.requiresCount
    ) {
      return t('subscriptionPresets.requires').replace('{0}', t(preset.requiresLabelKey))
    }
    return null
  }

  function handleClick(id: PresetId) {
    if (id === 'casual') handleCasual()
    else if (id === 'deep-diver') handleDeepDiver()
    else if (id === 'ai-only') handleAiOnly()
    else if (id === 'custom') onCustom()
  }

  function buttonLabel(id: PresetId): string {
    if (id === 'ai-only' || id === 'custom') return t('discover.select')
    return t('subscriptionPresets.setUp')
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-text">{t('subscriptionPresets.getStarted')}</p>
        <p className="text-xs text-muted mt-0.5">{t('subscriptionPresets.intro')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESETS.map((preset) => {
          const disabled = isDisabled(preset)
          const disabledReason = getDisabledReason(preset)
          const isLoading = loading === preset.id

          return (
            <div
              key={preset.id}
              className={`bg-surface border border-border rounded-lg p-4 flex flex-col gap-3 ${
                disabled && disabledReason ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5" aria-hidden="true">
                  {preset.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text">{t(preset.titleKey)}</p>
                  <p className="text-xs text-muted mt-0.5">{t(preset.descriptionKey)}</p>
                  {disabledReason && <p className="text-xs text-muted/60 mt-1">{disabledReason}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleClick(preset.id)}
                disabled={disabled}
                className={`w-full px-3 py-1.5 rounded-md text-sm font-medium transition-opacity ${
                  preset.id === 'ai-only' || preset.id === 'custom'
                    ? 'border border-border text-text hover:border-accent/40 hover:text-accent disabled:opacity-50'
                    : 'bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50'
                }`}
              >
                {isLoading ? t('subscriptionPresets.applying') : buttonLabel(preset.id)}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

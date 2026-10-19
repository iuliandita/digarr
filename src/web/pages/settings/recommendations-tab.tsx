import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { DEFAULT_PREFERENCES, type Preferences } from '@/db/schema'
import { BlockedAlbumsTab } from '../../components/blocked-albums-tab'
import { BlockedArtistsTab } from '../../components/blocked-artists-tab'
import { Field } from '../../components/field'
import { Hint } from '../../components/hint'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Input } from '../../components/ui/input'
import {
  getUserPreferences,
  listAlbumBlocks,
  listArtistBlocks,
  updateUserPreferences,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { prefersReducedMotion } from '../../lib/utils'
import { SliderField } from './shared'

const BLOCKED_COUNT_KEY = ['blocked-count']

function BlockedSection() {
  const { t } = useI18n()
  const { hash } = useLocation()
  const queryClient = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  const linked = hash === '#blocked'
  const [open, setOpen] = useState(linked)
  const { data: count } = useQuery({
    queryKey: BLOCKED_COUNT_KEY,
    queryFn: async () => {
      const [artists, albums] = await Promise.all([
        listArtistBlocks({ limit: 200 }),
        listAlbumBlocks(),
      ])
      return `${artists.items.length + albums.items.length}${artists.nextCursor ? '+' : ''}`
    },
  })

  useEffect(() => {
    if (!linked) return
    setOpen(true)
    ref.current?.scrollIntoView?.({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [linked])

  const refreshCount = () => void queryClient.invalidateQueries({ queryKey: BLOCKED_COUNT_KEY })

  return (
    <div ref={ref} className="scroll-mt-24">
      <Disclosure
        id="blocked"
        open={open}
        onOpenChange={setOpen}
        title={
          count === undefined
            ? t('settings.tabs.blocked')
            : `${t('settings.tabs.blocked')} - ${count}`
        }
      >
        <div className="space-y-8">
          <BlockedArtistsTab onChange={refreshCount} />
          <BlockedAlbumsTab onChange={refreshCount} />
        </div>
      </Disclosure>
    </div>
  )
}

export function RecommendationsTab() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: prefs, isLoading: prefsLoading } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
  })
  if (prefsLoading || !prefs) {
    return <div className="text-sm text-muted">{t('settings.loadingPreferences')}</div>
  }

  return <RecommendationsTabInner prefs={prefs} queryClient={queryClient} />
}

function RecommendationsTabInner({
  prefs,
  queryClient,
}: {
  prefs: Record<string, unknown>
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const { t } = useI18n()
  const { hash } = useLocation()
  const targetsNetNewAlbumDiscovery = hash === '#net-new-album-discovery'
  const weights =
    (prefs.scoringWeights as Preferences['scoringWeights']) ?? DEFAULT_PREFERENCES.scoringWeights

  const [scoreThreshold, setScoreThreshold] = useState((prefs.scoreThreshold as number) ?? 0.5)
  const [primaryGenres, setPrimaryGenres] = useState(
    ((prefs.primaryGenres as string[] | undefined) ?? []).join(', '),
  )
  const [secondaryGenres, setSecondaryGenres] = useState(
    ((prefs.secondaryGenres as string[] | undefined) ?? []).join(', '),
  )
  const [consensus, setConsensus] = useState(weights.consensus)
  const [similarity, setSimilarity] = useState(weights.similarity)
  const [genreOverlap, setGenreOverlap] = useState(weights.genreOverlap)
  const [aiConfidence, setAiConfidence] = useState(weights.aiConfidence)
  const [feedbackBoost, setFeedbackBoost] = useState(weights.feedbackBoost)
  const [popularity, setPopularity] = useState(weights.popularity ?? 0)
  const [rejectionCooldown, setRejectionCooldown] = useState(
    String((prefs.rejectionCooldownDays as number) ?? 90),
  )
  const [topArtistsLimit, setTopArtistsLimit] = useState(
    String((prefs.topArtistsLimit as number) ?? 30),
  )
  const [librarySeedRatio, setLibrarySeedRatio] = useState(
    (prefs.librarySeedRatio as number) ?? 0.3,
  )
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(
    (prefs.autoApproveEnabled as boolean) ?? false,
  )
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(
    (prefs.autoApproveThreshold as number) ?? 0.8,
  )
  const [autoApproveMonitorOption, setAutoApproveMonitorOption] = useState(
    (prefs.autoApproveMonitorOption as string) ?? 'all',
  )
  const [netNewAlbumDiscovery, setNetNewAlbumDiscovery] = useState(
    (prefs.netNewAlbumDiscovery as boolean) ?? false,
  )
  const recentPrefs = prefs.excludeRecentlyPlayed as Preferences['excludeRecentlyPlayed']
  const [excludeRecentEnabled, setExcludeRecentEnabled] = useState(recentPrefs?.enabled ?? false)
  const [excludeRecentWindow, setExcludeRecentWindow] = useState(
    String(recentPrefs?.windowDays ?? 30),
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!targetsNetNewAlbumDiscovery) return

    const target = document.getElementById('net-new-album-discovery')
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    })
    target?.focus({ preventScroll: true })
  }, [targetsNetNewAlbumDiscovery])

  const weightSum =
    consensus + similarity + genreOverlap + aiConfidence + feedbackBoost + popularity
  const weightsOk = Math.abs(weightSum - 1.0) < 0.01

  async function handleSave() {
    setSaving(true)
    try {
      await updateUserPreferences({
        scoreThreshold,
        primaryGenres: primaryGenres
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean),
        secondaryGenres: secondaryGenres
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean),
        scoringWeights: {
          consensus,
          similarity,
          genreOverlap,
          aiConfidence,
          feedbackBoost,
          popularity,
        },
        rejectionCooldownDays:
          parseInt(rejectionCooldown, 10) || (prefs.rejectionCooldownDays as number),
        topArtistsLimit: parseInt(topArtistsLimit, 10) || (prefs.topArtistsLimit as number),
        librarySeedRatio,
        autoApproveEnabled,
        autoApproveThreshold,
        autoApproveMonitorOption: autoApproveMonitorOption as
          | 'all'
          | 'new'
          | 'missing'
          | 'existing'
          | 'latest'
          | 'first'
          | 'none',
        netNewAlbumDiscovery,
        excludeRecentlyPlayed: {
          enabled: excludeRecentEnabled,
          windowDays: Math.min(365, Math.max(1, parseInt(excludeRecentWindow, 10) || 30)),
        },
      })
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      queryClient.invalidateQueries({ queryKey: ['recommendations'] })
      toast.success(t('settings.recommendationsSaved'))
    } catch {
      toast.error(t('settings.recommendationsFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <Hint id="settings-recommendations-tip" type="inline">
        {t('settings.recommendationsTip')}
      </Hint>

      <section className="space-y-4">
        <Field label={t('settings.primaryGenres')} id="primary-genres">
          <Input
            id="primary-genres"
            value={primaryGenres}
            onChange={(e) => setPrimaryGenres(e.target.value)}
            aria-describedby="genre-priority-help"
          />
        </Field>
        <Field label={t('settings.secondaryGenres')} id="secondary-genres">
          <Input
            id="secondary-genres"
            value={secondaryGenres}
            onChange={(e) => setSecondaryGenres(e.target.value)}
            aria-describedby="genre-priority-help"
          />
        </Field>
        <p id="genre-priority-help" className="text-xs text-muted">
          {t('settings.genrePriorityHelp')}
        </p>
      </section>

      {/* Essential - always visible */}
      <section className="space-y-4">
        <h2 className="text-lead font-semibold text-text">{t('settings.scoreThreshold')}</h2>
        <SliderField
          label={t('settings.minScoreToShow')}
          id="score-threshold"
          value={scoreThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={setScoreThreshold}
        />
      </section>

      {/* Tuning - collapsed by default */}
      <Disclosure title={t('settings.scoringWeights')}>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3">
            <span className={`text-xs tabular-nums ${weightsOk ? 'text-muted' : 'text-warning'}`}>
              {t('settings.totalWeight')} {weightSum.toFixed(2)}
              {weightsOk ? '' : ` ${t('settings.shouldSumToOne')}`}
            </span>
          </div>
          <SliderField
            label={t('settings.consensus')}
            id="w-consensus"
            value={consensus}
            min={0}
            max={1}
            step={0.05}
            onChange={setConsensus}
          />
          <SliderField
            label={t('settings.similarity')}
            id="w-similarity"
            value={similarity}
            min={0}
            max={1}
            step={0.05}
            onChange={setSimilarity}
          />
          <SliderField
            label={t('settings.genreOverlap')}
            id="w-genre"
            value={genreOverlap}
            min={0}
            max={1}
            step={0.05}
            onChange={setGenreOverlap}
          />
          <SliderField
            label={t('settings.aiConfidence')}
            id="w-ai"
            value={aiConfidence}
            min={0}
            max={1}
            step={0.05}
            onChange={setAiConfidence}
          />
          <SliderField
            label={t('settings.feedbackBoost')}
            id="w-feedback"
            value={feedbackBoost}
            min={0}
            max={1}
            step={0.05}
            onChange={setFeedbackBoost}
          />
          <SliderField
            label={t('settings.popularity')}
            id="w-popularity"
            value={popularity}
            min={0}
            max={1}
            step={0.05}
            onChange={setPopularity}
          />
          <p className="text-xs text-muted">{t('settings.popularityHelp')}</p>
        </div>
      </Disclosure>

      <Disclosure title={t('settings.autoApprove')}>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted">{t('settings.autoApproveDescription')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoApproveEnabled}
              onChange={(e) => setAutoApproveEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-sm text-text">{t('settings.enableAutoApprove')}</span>
          </label>
          {autoApproveEnabled && (
            <div className="space-y-3 pl-6">
              <SliderField
                label={t('settings.minimumScore')}
                id="auto-approve-threshold"
                value={autoApproveThreshold}
                min={0.5}
                max={1.0}
                step={0.05}
                onChange={setAutoApproveThreshold}
                displayValue={`${Math.round(autoApproveThreshold * 100)}%`}
              />
              <div className="space-y-1.5">
                <label htmlFor="auto-approve-monitor" className="text-sm text-muted">
                  {t('settings.monitorMode')}
                </label>
                <select
                  id="auto-approve-monitor"
                  value={autoApproveMonitorOption}
                  onChange={(e) => setAutoApproveMonitorOption(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  <option value="all">{t('settings.monitorAll')}</option>
                  <option value="missing">{t('settings.monitorMissing')}</option>
                  <option value="existing">{t('settings.monitorExisting')}</option>
                  <option value="latest">{t('settings.monitorLatest')}</option>
                  <option value="first">{t('settings.monitorFirst')}</option>

                  <option value="new">{t('settings.monitorNew')}</option>
                  <option value="none">{t('settings.monitorNone')}</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </Disclosure>

      {/* Advanced - collapsed by default */}
      {/* Keyed so a hash link arriving while this tab is mounted still opens the section */}
      <Disclosure
        key={targetsNetNewAlbumDiscovery ? 'targeted' : 'default'}
        title={t('settings.advancedSettings')}
        defaultOpen={targetsNetNewAlbumDiscovery}
      >
        <div className="space-y-6 pt-2">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted">{t('settings.limits')}</h3>
            <Field label={t('settings.rejectionCooldown')} id="rejection-cooldown">
              <Input
                id="rejection-cooldown"
                type="number"
                min={1}
                value={rejectionCooldown}
                onChange={(e) => setRejectionCooldown(e.target.value)}
                className="max-w-[120px]"
              />
            </Field>
            <Field label={t('settings.topArtistsLimit')} id="top-artists-limit">
              <Input
                id="top-artists-limit"
                type="number"
                min={1}
                value={topArtistsLimit}
                onChange={(e) => setTopArtistsLimit(e.target.value)}
                className="max-w-[120px]"
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={excludeRecentEnabled}
                onChange={(e) => setExcludeRecentEnabled(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm text-text">{t('settings.excludeRecentlyPlayed')}</span>
            </label>
            <p className="text-xs text-muted">{t('settings.excludeRecentlyPlayedHelp')}</p>
            {excludeRecentEnabled && (
              <Field label={t('settings.excludeRecentlyPlayedWindow')} id="exclude-recent-window">
                <Input
                  id="exclude-recent-window"
                  type="number"
                  min={1}
                  max={365}
                  value={excludeRecentWindow}
                  onChange={(e) => setExcludeRecentWindow(e.target.value)}
                  className="max-w-[120px]"
                />
              </Field>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted">{t('settings.libraryDiscovery')}</h3>
            <p className="text-xs text-muted">{t('settings.libraryDiscoveryHelp')}</p>
            <SliderField
              label={t('settings.librarySeedRatio')}
              id="library-seed-ratio"
              value={librarySeedRatio}
              min={0}
              max={1}
              step={0.05}
              onChange={setLibrarySeedRatio}
            />
            <label
              id="net-new-album-discovery"
              tabIndex={-1}
              className="scroll-mt-24 flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <input
                type="checkbox"
                checked={netNewAlbumDiscovery}
                onChange={(e) => setNetNewAlbumDiscovery(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm text-text">{t('settings.netNewAlbumDiscovery')}</span>
            </label>
            <p className="text-xs text-muted">{t('settings.netNewAlbumDiscoveryHelp')}</p>
          </section>
        </div>
      </Disclosure>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>

      <BlockedSection />
    </div>
  )
}

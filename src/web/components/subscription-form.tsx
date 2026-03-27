import { useState } from 'react'
import { CronPicker } from './cron-picker'

export type SubscriptionFormData = {
  name: string
  sourceType: string
  sourceProvider: string
  sourceConfig: Record<string, unknown>
  cron: string
  enabled: boolean
  maxArtistsPerRun: number
  action: string
  scoreThreshold: number | null
  scoringWeightPreset: string
}

type SubscriptionFormProps = {
  initial?: Partial<SubscriptionFormData>
  onSubmit: (data: SubscriptionFormData) => Promise<void>
  onCancel: () => void
  mode: 'create' | 'edit'
  configuredSources: string[]
}

const EDITABLE_SOURCE_TYPES = ['genre', 'similar'] as const

const SOURCE_TYPES = [
  { value: 'genre', label: 'Genre', description: 'Discover artists in a specific genre' },
  { value: 'similar', label: 'Similar', description: 'Find artists similar to your favorites' },
] as const

const SOURCE_PROVIDERS: ReadonlyArray<{
  value: string
  label: string
  capabilities: string[]
}> = [
  { value: 'lastfm', label: 'Last.fm', capabilities: ['genreArtists', 'similarArtists'] },
  { value: 'listenbrainz', label: 'ListenBrainz', capabilities: ['similarArtists'] },
  { value: 'discogs', label: 'Discogs', capabilities: ['genreArtists'] },
]

const WEIGHT_PRESETS = [
  { value: 'default', label: 'Default' },
  { value: 'genre', label: 'Genre-optimized' },
] as const

const SOURCE_TYPE_LABELS: Record<string, string> = {
  'spotify-charts': 'Spotify Charts',
  'spotify-playlist': 'Spotify Playlist',
  'lastfm-tag': 'Last.fm Tag',
  'lastfm-charts': 'Last.fm Charts',
  listenbrainz: 'ListenBrainz Feed',
}

function describeSourceConfig(sourceType: string, config: Record<string, unknown>): string | null {
  if (sourceType === 'spotify-charts') {
    const parts = [config.chartType, config.region].filter(Boolean)
    return parts.length > 0 ? parts.join(' / ') : null
  }
  if (sourceType === 'spotify-playlist') return (config.playlistName as string) ?? null
  if (sourceType === 'lastfm-tag') return (config.tag as string) ?? null
  if (sourceType === 'listenbrainz') return (config.feedType as string) ?? null
  return null
}

export function SubscriptionForm({
  initial,
  onSubmit,
  onCancel,
  mode,
  configuredSources,
}: SubscriptionFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [sourceType, setSourceType] = useState(initial?.sourceType ?? 'genre')
  const [providers, setProviders] = useState<string[]>(
    (initial?.sourceConfig?.providers as string[]) ??
      configuredSources.filter((id) => SOURCE_PROVIDERS.some((p) => p.value === id)),
  )
  const [genre, setGenre] = useState((initial?.sourceConfig?.genre as string) ?? '')
  const [seedArtistInput, setSeedArtistInput] = useState(
    (initial?.sourceConfig?.seedArtists as Array<{ name: string }>)
      ?.map((a) => a.name)
      .join(', ') ?? '',
  )
  const [cron, setCron] = useState(initial?.cron ?? '0 8 * * 0')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [maxArtists, setMaxArtists] = useState(initial?.maxArtistsPerRun ?? 20)
  const [weightPreset, setWeightPreset] = useState(
    initial?.scoringWeightPreset ??
      ((initial?.sourceType ?? 'genre') === 'similar' ? 'default' : 'genre'),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Source type/config is locked when editing a subscription type the form can't render
  // (e.g. preset-created spotify-charts, lastfm-tag, listenbrainz subs).
  // Users can still edit name, schedule, max artists, scoring, and enabled state.
  const sourceEditable =
    mode === 'create' ||
    (EDITABLE_SOURCE_TYPES as readonly string[]).includes(initial?.sourceType ?? 'genre')

  function handleSourceTypeChange(nextType: string) {
    setSourceType(nextType)
    const capability = nextType === 'similar' ? 'similarArtists' : 'genreArtists'
    const relevant = configuredSources.filter((id) =>
      SOURCE_PROVIDERS.some(
        (provider) => provider.value === id && provider.capabilities.includes(capability),
      ),
    )
    setProviders((prev) => {
      const kept = prev.filter((id) => relevant.includes(id))
      return kept.length > 0 ? kept : relevant
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (sourceEditable) {
      if (sourceType === 'genre' && !genre.trim()) {
        setError('Genre is required')
        return
      }
      if (sourceType === 'similar' && !seedArtistInput.trim()) {
        setError('At least one seed artist is required')
        return
      }
      if (providers.length === 0) {
        setError('Select at least one source')
        return
      }
    }

    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        sourceType: sourceEditable ? sourceType : (initial?.sourceType ?? sourceType),
        sourceProvider: sourceEditable
          ? providers.join(',')
          : (initial?.sourceProvider ?? providers.join(',')),
        sourceConfig: sourceEditable
          ? sourceType === 'genre'
            ? { genre: genre.trim(), providers }
            : {
                seedArtists: seedArtistInput
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((n) => ({ name: n })),
                providers,
              }
          : (initial?.sourceConfig ?? {}),
        cron,
        enabled,
        maxArtistsPerRun: maxArtists,
        action: 'add_to_recommendations',
        scoreThreshold: null,
        scoringWeightPreset: weightPreset,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? 'Create subscription' : 'Edit subscription'}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal content panel */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation prevents backdrop dismiss */}
      <div
        className="bg-bg border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text">
            {mode === 'create' ? 'Create Subscription' : 'Edit Subscription'}
          </h2>

          {error && (
            <div className="text-sm text-reject bg-reject/10 border border-reject/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="sub-name" className="block text-sm font-medium text-text mb-1">
              Name
            </label>
            <input
              id="sub-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New Shoegaze Weekly"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {sourceEditable ? (
            <>
              {/* Source type */}
              <div>
                <label
                  htmlFor="sub-source-type"
                  className="block text-sm font-medium text-text mb-1"
                >
                  Source Type
                </label>
                <select
                  id="sub-source-type"
                  value={sourceType}
                  onChange={(e) => handleSourceTypeChange(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:border-accent focus:outline-none"
                >
                  {SOURCE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} -- {t.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Config: depends on source type */}
              {sourceType === 'genre' ? (
                <div>
                  <label htmlFor="sub-genre" className="block text-sm font-medium text-text mb-1">
                    Genre
                  </label>
                  <input
                    id="sub-genre"
                    type="text"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    placeholder="shoegaze"
                    className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="sub-seeds" className="block text-sm font-medium text-text mb-1">
                    Seed Artists
                  </label>
                  <input
                    id="sub-seeds"
                    type="text"
                    value={seedArtistInput}
                    onChange={(e) => setSeedArtistInput(e.target.value)}
                    placeholder="Radiohead, Portishead, Massive Attack"
                    className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                  <p className="text-xs text-muted mt-1">Comma-separated artist names</p>
                </div>
              )}

              {/* Source providers (multiselect, filtered by capability) */}
              <div>
                <span className="block text-sm font-medium text-text mb-1">Sources</span>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_PROVIDERS.filter((p) =>
                    p.capabilities.includes(
                      sourceType === 'similar' ? 'similarArtists' : 'genreArtists',
                    ),
                  ).map((p) => {
                    const configured = configuredSources.includes(p.value)
                    const selected = providers.includes(p.value)
                    return (
                      <button
                        key={p.value}
                        type="button"
                        disabled={!configured}
                        onClick={() => {
                          setProviders((prev) =>
                            prev.includes(p.value)
                              ? prev.filter((v) => v !== p.value)
                              : [...prev, p.value],
                          )
                        }}
                        className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                          !configured
                            ? 'border-border text-muted/50 cursor-not-allowed bg-surface/50'
                            : selected
                              ? 'border-accent/50 bg-accent/15 text-accent'
                              : 'border-border text-muted hover:border-accent/40 hover:text-text'
                        }`}
                        title={configured ? undefined : 'Configure in Settings > Connections'}
                      >
                        {p.label}
                        {!configured && <span className="text-xs ml-1">(not configured)</span>}
                      </button>
                    )
                  })}
                </div>
                {providers.length === 0 && (
                  <p className="text-xs text-reject mt-1">Select at least one source</p>
                )}
              </div>
            </>
          ) : (
            <div>
              <span className="block text-sm font-medium text-text mb-1">Source</span>
              <div className="px-3 py-2 bg-surface/50 border border-border rounded text-sm text-muted">
                {SOURCE_TYPE_LABELS[initial?.sourceType ?? ''] ?? initial?.sourceType}
                {initial?.sourceConfig &&
                  (() => {
                    const detail = describeSourceConfig(
                      initial.sourceType ?? '',
                      initial.sourceConfig as Record<string, unknown>,
                    )
                    return detail ? ` -- ${detail}` : null
                  })()}
              </div>
              <p className="text-xs text-muted mt-1">
                Source type and config cannot be changed for this subscription.
              </p>
            </div>
          )}

          {/* Schedule */}
          <div>
            <span className="block text-sm font-medium text-text mb-1">Schedule</span>
            <CronPicker value={cron} onChange={setCron} />
          </div>

          {/* Max artists per run */}
          <div>
            <label htmlFor="sub-max" className="block text-sm font-medium text-text mb-1">
              Max artists per run
            </label>
            <input
              id="sub-max"
              type="number"
              min={1}
              max={100}
              value={maxArtists}
              onChange={(e) => setMaxArtists(Number(e.target.value))}
              className="w-24 px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:border-accent focus:outline-none"
            />
          </div>

          {/* Weight preset */}
          <div>
            <label htmlFor="sub-preset" className="block text-sm font-medium text-text mb-1">
              Scoring preset
            </label>
            <select
              id="sub-preset"
              value={weightPreset}
              onChange={(e) => setWeightPreset(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:border-accent focus:outline-none"
            >
              {WEIGHT_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-border"
              id="sub-enabled"
            />
            <label htmlFor="sub-enabled" className="text-sm text-text">
              Enabled
            </label>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted hover:text-text border border-border rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-accent text-accent-fg rounded font-medium hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

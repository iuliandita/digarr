import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { ServiceCard } from '../components/service-card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import {
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getSettings,
  testService,
  triggerPipeline,
  updateSettings,
} from '../lib/api'
import { useFetch } from '../lib/hooks'

// --- Types ---

type AiProvider = 'anthropic' | 'openai' | 'ollama'

type ScoringWeights = {
  consensus: number
  similarity: number
  genreOverlap: number
  aiConfidence: number
  feedbackBoost: number
}

type Preferences = {
  qualityProfileId?: number
  metadataProfileId?: number
  rootFolderId?: number
  scheduleCron?: string
  scoreThreshold?: number
  scoringWeights?: ScoringWeights
  rejectionCooldownDays?: number
  topArtistsLimit?: number
  librarySeedRatio?: number
}

type Settings = {
  lidarrUrl?: string
  lidarrApiKey?: string
  listenbrainzUsername?: string
  listenbrainzToken?: string
  lastfmUsername?: string
  lastfmApiKey?: string
  aiProvider?: AiProvider
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
  preferences?: Preferences
  setupComplete?: boolean
}

type Tab = 'connections' | 'recommendations' | 'schedule'

// --- Field wrapper ---

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

// --- Tab switcher ---

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'connections', label: 'Connections' },
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'schedule', label: 'Schedule' },
  ]
  return (
    <div className="flex gap-1 border-b border-border mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={[
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            active === t.id
              ? 'border-accent text-text'
              : 'border-transparent text-muted hover:text-text',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// --- Slider with value display ---

function SliderField({
  label,
  id,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
}: {
  label: string
  id: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  displayValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm text-muted">
          {label}
        </label>
        <span className="text-sm font-medium text-text tabular-nums">
          {displayValue ?? value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)] cursor-pointer"
      />
    </div>
  )
}

// --- Connections Tab ---

type ServiceTestState = 'idle' | 'testing' | 'ok' | 'error'

function ConnectionsTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const prefs = settings.preferences ?? {}
  const [lidarrUrl, setLidarrUrl] = useState(settings.lidarrUrl ?? '')
  const [lidarrApiKey, setLidarrApiKey] = useState(
    settings.lidarrApiKey === '***' ? '' : (settings.lidarrApiKey ?? ''),
  )
  const [qualityProfileId, setQualityProfileId] = useState(String(prefs.qualityProfileId ?? 1))
  const [metadataProfileId, setMetadataProfileId] = useState(String(prefs.metadataProfileId ?? 1))
  const [lbUsername, setLbUsername] = useState(settings.listenbrainzUsername ?? '')
  const [lbToken, setLbToken] = useState(
    settings.listenbrainzToken === '***' ? '' : (settings.listenbrainzToken ?? ''),
  )
  const [lfUsername, setLfUsername] = useState(settings.lastfmUsername ?? '')
  const [lfApiKey, setLfApiKey] = useState(
    settings.lastfmApiKey === '***' ? '' : (settings.lastfmApiKey ?? ''),
  )
  const [aiProvider, setAiProvider] = useState<AiProvider>(settings.aiProvider ?? 'anthropic')
  const [aiModel, setAiModel] = useState(settings.aiModel ?? '')
  const [aiApiKey, setAiApiKey] = useState(
    settings.aiApiKey === '***' ? '' : (settings.aiApiKey ?? ''),
  )
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl ?? '')

  const [tests, setTests] = useState<Record<string, ServiceTestState>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // Fetch Lidarr profiles
  const profilesFetcher = useCallback(() => getLidarrProfiles(), [])
  const { data: qualityProfiles } = useFetch<Array<{ id: number; name: string }>>(profilesFetcher)
  const metadataFetcher = useCallback(() => getLidarrMetadataProfiles(), [])
  const { data: metadataProfiles } = useFetch<Array<{ id: number; name: string }>>(metadataFetcher)

  function setTest(key: string, val: ServiceTestState) {
    setTests((prev) => ({ ...prev, [key]: val }))
  }
  function setSave(key: string, val: boolean) {
    setSaving((prev) => ({ ...prev, [key]: val }))
  }

  const configuredServices: Record<string, boolean> = {
    lidarr: Boolean(settings.lidarrUrl && settings.lidarrApiKey),
    listenbrainz: Boolean(settings.listenbrainzUsername && settings.listenbrainzToken),
    lastfm: Boolean(settings.lastfmUsername && settings.lastfmApiKey),
    ai: Boolean(settings.aiProvider && settings.aiModel),
  }

  function serviceStatus(key: string): 'connected' | 'not_configured' | 'error' | 'testing' {
    const t = tests[key]
    if (t === 'testing') return 'testing'
    if (t === 'ok') return 'connected'
    if (t === 'error') return 'error'
    // If no test has been run but the service has saved credentials, show as connected
    if (configuredServices[key]) return 'connected'
    return 'not_configured'
  }

  async function testLidarr() {
    setTest('lidarr', 'testing')
    try {
      const res = await testService('lidarr', { url: lidarrUrl, apiKey: lidarrApiKey })
      setTest('lidarr', res.success ? 'ok' : 'error')
      if (res.success) toast.success('Lidarr connected')
      else toast.error(res.message || 'Lidarr connection failed')
    } catch {
      setTest('lidarr', 'error')
      toast.error('Could not reach Lidarr')
    }
  }

  async function saveLidarr() {
    setSave('lidarr', true)
    try {
      await updateSettings({
        lidarrUrl,
        lidarrApiKey: lidarrApiKey || undefined,
        preferences: {
          ...prefs,
          qualityProfileId: parseInt(qualityProfileId, 10) || prefs.qualityProfileId,
          metadataProfileId: parseInt(metadataProfileId, 10) || prefs.metadataProfileId,
        },
      })
      toast.success('Lidarr settings saved')
      onSaved()
    } catch {
      toast.error('Failed to save Lidarr settings')
    } finally {
      setSave('lidarr', false)
    }
  }

  async function testListenbrainz() {
    setTest('listenbrainz', 'testing')
    try {
      const res = await testService('listenbrainz', { username: lbUsername, token: lbToken })
      setTest('listenbrainz', res.success ? 'ok' : 'error')
      if (res.success) toast.success('ListenBrainz connected')
      else toast.error(res.message || 'ListenBrainz connection failed')
    } catch {
      setTest('listenbrainz', 'error')
      toast.error('Could not reach ListenBrainz')
    }
  }

  async function saveListenbrainz() {
    setSave('listenbrainz', true)
    try {
      await updateSettings({
        listenbrainzUsername: lbUsername,
        listenbrainzToken: lbToken || undefined,
      })
      toast.success('ListenBrainz settings saved')
      onSaved()
    } catch {
      toast.error('Failed to save ListenBrainz settings')
    } finally {
      setSave('listenbrainz', false)
    }
  }

  async function testLastfm() {
    setTest('lastfm', 'testing')
    try {
      const res = await testService('lastfm', { username: lfUsername, apiKey: lfApiKey })
      setTest('lastfm', res.success ? 'ok' : 'error')
      if (res.success) toast.success('Last.fm connected')
      else toast.error(res.message || 'Last.fm connection failed')
    } catch {
      setTest('lastfm', 'error')
      toast.error('Could not reach Last.fm')
    }
  }

  async function saveLastfm() {
    setSave('lastfm', true)
    try {
      await updateSettings({ lastfmUsername: lfUsername, lastfmApiKey: lfApiKey || undefined })
      toast.success('Last.fm settings saved')
      onSaved()
    } catch {
      toast.error('Failed to save Last.fm settings')
    } finally {
      setSave('lastfm', false)
    }
  }

  async function testAi() {
    setTest('ai', 'testing')
    const config: Record<string, string> = { provider: aiProvider, model: aiModel }
    if (aiProvider !== 'ollama') config.apiKey = aiApiKey
    if (aiProvider === 'ollama') config.baseUrl = aiBaseUrl
    try {
      const res = await testService('ai', config)
      setTest('ai', res.success ? 'ok' : 'error')
      if (res.success) toast.success('AI provider connected')
      else toast.error(res.message || 'AI connection failed')
    } catch {
      setTest('ai', 'error')
      toast.error('Could not reach AI provider')
    }
  }

  async function saveAi() {
    setSave('ai', true)
    try {
      await updateSettings({
        aiProvider,
        aiModel: aiModel || undefined,
        aiApiKey: aiApiKey || undefined,
        aiBaseUrl: aiBaseUrl || undefined,
      })
      toast.success('AI settings saved')
      onSaved()
    } catch {
      toast.error('Failed to save AI settings')
    } finally {
      setSave('ai', false)
    }
  }

  const isLidarrConfigured = !!(lidarrUrl || settings.lidarrUrl)
  const isLbConfigured = !!(lbUsername || settings.listenbrainzUsername)
  const isLfConfigured = !!(lfUsername || settings.lastfmUsername)
  const isAiConfigured = !!(aiModel || settings.aiModel)

  return (
    <div className="space-y-4">
      {/* Lidarr */}
      <div className={isLidarrConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Lidarr"
          description="Music library manager -- required for adding artists"
          status={serviceStatus('lidarr')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="URL" id="lidarr-url">
              <Input
                id="lidarr-url"
                type="url"
                placeholder="http://localhost:8686"
                value={lidarrUrl}
                onChange={(e) => setLidarrUrl(e.target.value)}
              />
            </Field>
            <Field label="API Key" id="lidarr-apikey">
              <Input
                id="lidarr-apikey"
                type="password"
                placeholder={settings.lidarrApiKey === '***' ? '(saved)' : 'Your Lidarr API key'}
                value={lidarrApiKey}
                onChange={(e) => setLidarrApiKey(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quality Profile" id="quality-profile">
              <Select
                id="quality-profile"
                value={qualityProfileId}
                onChange={(e) => setQualityProfileId(e.target.value)}
              >
                {qualityProfiles ? (
                  qualityProfiles.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))
                ) : (
                  <option value={qualityProfileId}>Loading...</option>
                )}
              </Select>
            </Field>
            <Field label="Metadata Profile" id="metadata-profile">
              <Select
                id="metadata-profile"
                value={metadataProfileId}
                onChange={(e) => setMetadataProfileId(e.target.value)}
              >
                {metadataProfiles ? (
                  metadataProfiles.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))
                ) : (
                  <option value={metadataProfileId}>Loading...</option>
                )}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testLidarr}
              disabled={tests.lidarr === 'testing'}
            >
              {tests.lidarr === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveLidarr} disabled={saving.lidarr}>
              {saving.lidarr ? 'Saving...' : isLidarrConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* ListenBrainz */}
      <div className={isLbConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="ListenBrainz"
          description="Open-source listening history tracking"
          status={serviceStatus('listenbrainz')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" id="lb-username">
              <Input
                id="lb-username"
                placeholder="your-username"
                value={lbUsername}
                onChange={(e) => setLbUsername(e.target.value)}
              />
            </Field>
            <Field label="User Token" id="lb-token">
              <Input
                id="lb-token"
                type="password"
                placeholder={
                  settings.listenbrainzToken === '***' ? '(saved)' : 'ListenBrainz token'
                }
                value={lbToken}
                onChange={(e) => setLbToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testListenbrainz}
              disabled={tests.listenbrainz === 'testing'}
            >
              {tests.listenbrainz === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveListenbrainz} disabled={saving.listenbrainz}>
              {saving.listenbrainz ? 'Saving...' : isLbConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Last.fm */}
      <div className={isLfConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Last.fm"
          description="Music scrobbling and listening history"
          status={serviceStatus('lastfm')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" id="lfm-username">
              <Input
                id="lfm-username"
                placeholder="your-username"
                value={lfUsername}
                onChange={(e) => setLfUsername(e.target.value)}
              />
            </Field>
            <Field label="API Key" id="lfm-apikey">
              <Input
                id="lfm-apikey"
                type="password"
                placeholder={settings.lastfmApiKey === '***' ? '(saved)' : 'Last.fm API key'}
                value={lfApiKey}
                onChange={(e) => setLfApiKey(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testLastfm}
              disabled={tests.lastfm === 'testing'}
            >
              {tests.lastfm === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveLastfm} disabled={saving.lastfm}>
              {saving.lastfm ? 'Saving...' : isLfConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* AI Provider */}
      <div className={isAiConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="AI Provider"
          description="Generates music recommendations"
          status={serviceStatus('ai')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" id="ai-provider">
              <Select
                id="ai-provider"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiProvider)}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (local)</option>
              </Select>
            </Field>
            <Field label="Model" id="ai-model">
              <Input
                id="ai-model"
                placeholder={
                  aiProvider === 'anthropic'
                    ? 'claude-3-5-haiku-20241022'
                    : aiProvider === 'openai'
                      ? 'gpt-4o-mini'
                      : 'llama3.2'
                }
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
              />
            </Field>
          </div>
          {aiProvider !== 'ollama' && (
            <Field label="API Key" id="ai-apikey">
              <Input
                id="ai-apikey"
                type="password"
                placeholder={settings.aiApiKey === '***' ? '(saved)' : 'API key'}
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
              />
            </Field>
          )}
          {aiProvider === 'ollama' && (
            <Field label="Base URL" id="ai-baseurl">
              <Input
                id="ai-baseurl"
                type="url"
                placeholder="http://localhost:11434"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
              />
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={testAi} disabled={tests.ai === 'testing'}>
              {tests.ai === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveAi} disabled={saving.ai}>
              {saving.ai ? 'Saving...' : isAiConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>
    </div>
  )
}

// --- Recommendations Tab ---

const DEFAULT_WEIGHTS: ScoringWeights = {
  consensus: 0.3,
  similarity: 0.25,
  genreOverlap: 0.2,
  aiConfidence: 0.15,
  feedbackBoost: 0.1,
}

function RecommendationsTab({ settings }: { settings: Settings }) {
  const prefs = settings.preferences ?? {}
  const weights = prefs.scoringWeights ?? DEFAULT_WEIGHTS

  const [scoreThreshold, setScoreThreshold] = useState(prefs.scoreThreshold ?? 0.5)
  const [consensus, setConsensus] = useState(weights.consensus)
  const [similarity, setSimilarity] = useState(weights.similarity)
  const [genreOverlap, setGenreOverlap] = useState(weights.genreOverlap)
  const [aiConfidence, setAiConfidence] = useState(weights.aiConfidence)
  const [feedbackBoost, setFeedbackBoost] = useState(weights.feedbackBoost)
  const [rejectionCooldown, setRejectionCooldown] = useState(
    String(prefs.rejectionCooldownDays ?? 90),
  )
  const [topArtistsLimit, setTopArtistsLimit] = useState(String(prefs.topArtistsLimit ?? 30))
  const [librarySeedRatio, setLibrarySeedRatio] = useState(prefs.librarySeedRatio ?? 0.3)
  const [saving, setSaving] = useState(false)

  const weightSum = consensus + similarity + genreOverlap + aiConfidence + feedbackBoost
  const weightsOk = Math.abs(weightSum - 1.0) < 0.01

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({
        preferences: {
          ...prefs,
          scoreThreshold,
          scoringWeights: { consensus, similarity, genreOverlap, aiConfidence, feedbackBoost },
          rejectionCooldownDays: parseInt(rejectionCooldown, 10) || prefs.rejectionCooldownDays,
          topArtistsLimit: parseInt(topArtistsLimit, 10) || prefs.topArtistsLimit,
          librarySeedRatio,
        },
      })
      toast.success('Recommendation settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Score Threshold</h2>
        <SliderField
          label="Minimum score to show recommendation"
          id="score-threshold"
          value={scoreThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={setScoreThreshold}
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Scoring Weights
          </h2>
          <span className={`text-xs tabular-nums ${weightsOk ? 'text-muted' : 'text-yellow-400'}`}>
            total: {weightSum.toFixed(2)}
            {weightsOk ? '' : ' (should sum to 1.0)'}
          </span>
        </div>
        <SliderField
          label="Consensus"
          id="w-consensus"
          value={consensus}
          min={0}
          max={1}
          step={0.05}
          onChange={setConsensus}
        />
        <SliderField
          label="Similarity"
          id="w-similarity"
          value={similarity}
          min={0}
          max={1}
          step={0.05}
          onChange={setSimilarity}
        />
        <SliderField
          label="Genre Overlap"
          id="w-genre"
          value={genreOverlap}
          min={0}
          max={1}
          step={0.05}
          onChange={setGenreOverlap}
        />
        <SliderField
          label="AI Confidence"
          id="w-ai"
          value={aiConfidence}
          min={0}
          max={1}
          step={0.05}
          onChange={setAiConfidence}
        />
        <SliderField
          label="Feedback Boost"
          id="w-feedback"
          value={feedbackBoost}
          min={0}
          max={1}
          step={0.05}
          onChange={setFeedbackBoost}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Limits</h2>
        <Field label="Rejection cooldown (days)" id="rejection-cooldown">
          <Input
            id="rejection-cooldown"
            type="number"
            min={1}
            value={rejectionCooldown}
            onChange={(e) => setRejectionCooldown(e.target.value)}
            className="max-w-[120px]"
          />
        </Field>
        <Field label="Top artists limit" id="top-artists-limit">
          <Input
            id="top-artists-limit"
            type="number"
            min={1}
            value={topArtistsLimit}
            onChange={(e) => setTopArtistsLimit(e.target.value)}
            className="max-w-[120px]"
          />
        </Field>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          Library Discovery
        </h2>
        <p className="text-xs text-muted">
          How much of the discovery should be seeded from your existing Lidarr library vs listening
          history. Higher values find artists similar to what you already own. Lower values rely
          more on ListenBrainz/Last.fm listening data.
        </p>
        <SliderField
          label="Library seed ratio"
          id="library-seed-ratio"
          value={librarySeedRatio}
          min={0}
          max={1}
          step={0.05}
          onChange={setLibrarySeedRatio}
        />
      </section>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
}

// --- Schedule Tab ---

type CronPreset = { label: string; value: string }

const PRESETS: CronPreset[] = [
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
  { label: 'Biweekly', value: '0 0 1,15 * *' },
  { label: 'Monthly', value: '0 0 1 * *' },
]

function ScheduleTab({ settings }: { settings: Settings }) {
  const prefs = settings.preferences ?? {}
  const [cron, setCron] = useState(prefs.scheduleCron ?? '0 0 * * *')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({ preferences: { ...prefs, scheduleCron: cron } })
      toast.success('Schedule saved')
    } catch {
      toast.error('Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    setRunning(true)
    try {
      await triggerPipeline()
      toast.success('Pipeline started')
    } catch {
      toast.error('Failed to trigger pipeline')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Presets</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={cron === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCron(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Custom Cron</h2>
        <Field label="Cron expression" id="cron-expr">
          <Input
            id="cron-expr"
            placeholder="0 0 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="font-mono"
          />
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="outline" onClick={handleRunNow} disabled={running}>
          {running ? 'Starting...' : 'Run Now'}
        </Button>
      </div>
    </div>
  )
}

// --- Skeleton loader ---

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border mb-6">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-28 mb-1" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-lg" />
      ))}
    </div>
  )
}

// --- Main Page ---

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('connections')
  const fetcher = useCallback(() => getSettings(), [])
  const { data, loading, error, refetch } = useFetch<Settings>(fetcher)

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <h1 className="text-2xl font-bold text-text mb-6">Settings</h1>
        <SettingsSkeleton />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8 text-reject">
        <p>Failed to load settings: {error?.message ?? 'Unknown error'}</p>
        <Button variant="outline" size="sm" onClick={refetch} className="mt-3">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-text mb-6">Settings</h1>
      <TabBar active={tab} onChange={setTab} />
      {tab === 'connections' && <ConnectionsTab settings={data} onSaved={refetch} />}
      {tab === 'recommendations' && <RecommendationsTab settings={data} />}
      {tab === 'schedule' && <ScheduleTab settings={data} />}
    </div>
  )
}

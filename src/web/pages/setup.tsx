import { Compass } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field } from '../components/field'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { completeSetup, testService } from '../lib/api'

type FormState = {
  lidarr: { url: string; apiKey: string; skipTlsVerify: boolean }
  ai: { provider: string; model: string; apiKey: string; baseUrl: string }
}

type TestResults = {
  lidarr: boolean | null
  ai: boolean | null
}

type TestingState = {
  lidarr: boolean
  ai: boolean
}

type SetupMode = 'lidarr' | 'discover'

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current

        return (
          <div key={step} className="flex items-center">
            <div
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border',
                active
                  ? 'bg-accent text-accent-fg border-accent'
                  : done
                    ? 'bg-approve text-bg border-approve'
                    : 'bg-surface text-muted border-border',
              ].join(' ')}
            >
              {done ? (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-label="Step complete"
                  role="img"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step
              )}
            </div>
            {i < total - 1 && (
              <div className={['h-px w-12', done ? 'bg-approve' : 'bg-border'].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepMode({
  mode,
  onSelect,
}: {
  mode: SetupMode | null
  onSelect: (m: SetupMode) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">How do you manage music?</h2>
        <p className="text-sm text-muted mt-1">
          This determines how approved recommendations are handled.
        </p>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onSelect('lidarr')}
          className={[
            'w-full text-left rounded-lg border p-4 transition-colors',
            mode === 'lidarr'
              ? 'border-accent bg-accent/10'
              : 'border-border bg-surface hover:border-accent/50',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <img src="/icons/lidarr.png" alt="" className="w-8 h-8" />
            <div>
              <span className="text-sm font-medium text-text">Lidarr</span>
              <p className="text-xs text-muted mt-0.5">
                Approved artists are added to Lidarr for automatic download
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSelect('discover')}
          className={[
            'w-full text-left rounded-lg border p-4 transition-colors',
            mode === 'discover'
              ? 'border-accent bg-accent/10'
              : 'border-border bg-surface hover:border-accent/50',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
              <Compass size={18} className="text-accent" />
            </div>
            <div>
              <span className="text-sm font-medium text-text">Just discover</span>
              <p className="text-xs text-muted mt-0.5">
                Curate a personal list of recommendations. Export as JSON, CSV, or M3U.
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

function StepLidarr({
  form,
  onFormChange,
  testing,
  onTest,
}: {
  form: FormState['lidarr']
  onFormChange: (v: FormState['lidarr']) => void
  testing: boolean
  onTest: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">Connect Lidarr</h2>
        <p className="text-sm text-muted mt-1">Lidarr manages your music library and downloads.</p>
      </div>
      <Field label="Lidarr URL" id="lidarr-url">
        <Input
          id="lidarr-url"
          type="url"
          placeholder="http://localhost:8686"
          value={form.url}
          onChange={(e) => onFormChange({ ...form, url: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={form.skipTlsVerify}
          onChange={(e) => onFormChange({ ...form, skipTlsVerify: e.target.checked })}
          className="rounded border-border"
        />
        Skip TLS verification
      </label>
      <Field label="API Key" id="lidarr-apikey">
        <Input
          id="lidarr-apikey"
          type="password"
          placeholder="Your Lidarr API key"
          value={form.apiKey}
          onChange={(e) => onFormChange({ ...form, apiKey: e.target.value })}
        />
      </Field>
      <Button onClick={onTest} disabled={!form.url || !form.apiKey || testing} className="w-full">
        {testing ? 'Testing...' : 'Test & Continue'}
      </Button>
    </div>
  )
}

function StepAi({
  form,
  onFormChange,
  testing,
  onTest,
}: {
  form: FormState['ai']
  onFormChange: (v: FormState['ai']) => void
  testing: boolean
  onTest: () => void
}) {
  const needsApiKey = form.provider !== 'ollama' && form.provider !== 'openai-compatible'
  const apiKeyOptional = form.provider === 'openai-compatible'
  const needsBaseUrl = form.provider === 'ollama' || form.provider === 'openai-compatible'

  const modelSuggestions: Record<string, Array<{ value: string; label: string }>> = {
    anthropic: [
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast, cheapest)' },
      { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
      { value: 'claude-opus-4-6', label: 'Opus 4.6 (most capable)' },
    ],
    openai: [
      { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano (fast, cheapest)' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (balanced)' },
      { value: 'gpt-5.4', label: 'GPT-5.4 (most capable)' },
    ],
    gemini: [
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (fast, preview)' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (stable)' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (most capable)' },
    ],
    ollama: [
      { value: 'llama4', label: 'Llama 4' },
      { value: 'qwen3', label: 'Qwen 3' },
      { value: 'deepseek-r1', label: 'DeepSeek R1' },
    ],
  }

  const apiKeyLinks: Record<string, { url: string; label: string }> = {
    anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'Get API key' },
    openai: { url: 'https://platform.openai.com/api-keys', label: 'Get API key' },
    gemini: { url: 'https://aistudio.google.com/app/apikey', label: 'Get API key' },
  }

  const link = apiKeyLinks[form.provider]
  const suggestions = modelSuggestions[form.provider] ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">AI Provider</h2>
        <p className="text-sm text-muted mt-1">Used to generate music recommendations. Required.</p>
        <p className="text-xs text-muted mt-2">
          You&apos;ll connect personal listening sources later in Settings after you log in.
        </p>
      </div>
      <Field label="Provider" id="ai-provider">
        <Select
          id="ai-provider"
          value={form.provider}
          onChange={(e) => onFormChange({ ...form, provider: e.target.value, model: '' })}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama (local)</option>
          <option value="openai-compatible">OpenAI-Compatible</option>
        </Select>
      </Field>
      <Field label="Model" id="ai-model">
        <Input
          id="ai-model"
          list="ai-model-suggestions"
          placeholder={suggestions[0]?.value ?? 'model-name'}
          value={form.model}
          onChange={(e) => onFormChange({ ...form, model: e.target.value })}
        />
        {suggestions.length > 0 && (
          <datalist id="ai-model-suggestions">
            {suggestions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </datalist>
        )}
      </Field>
      {(needsApiKey || apiKeyOptional) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="ai-apikey" className="text-sm text-muted">
              {apiKeyOptional ? 'API Key (optional)' : 'API Key'}
            </label>
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                {link.label}
              </a>
            )}
          </div>
          <Input
            id="ai-apikey"
            type="password"
            placeholder={form.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            value={form.apiKey}
            onChange={(e) => onFormChange({ ...form, apiKey: e.target.value })}
          />
        </div>
      )}
      {needsBaseUrl && (
        <Field label="Base URL" id="ai-baseurl">
          <Input
            id="ai-baseurl"
            type="url"
            placeholder={
              form.provider === 'openai-compatible'
                ? 'http://localhost:8080'
                : 'http://localhost:11434'
            }
            value={form.baseUrl}
            onChange={(e) => onFormChange({ ...form, baseUrl: e.target.value })}
          />
        </Field>
      )}
      {form.provider === 'openai-compatible' && (
        <p className="text-xs text-muted">
          Works with Groq, OpenRouter, LiteLLM, LocalAI, and any OpenAI-compatible endpoint. API key
          is optional for local services.
        </p>
      )}
      <Button
        onClick={onTest}
        disabled={
          !form.model || (needsApiKey && !form.apiKey) || (needsBaseUrl && !form.baseUrl) || testing
        }
        className="w-full"
      >
        {testing ? 'Testing...' : 'Test & Continue'}
      </Button>
    </div>
  )
}

function StepDone({
  form,
  mode,
  onStart,
  starting,
}: {
  form: FormState
  mode: SetupMode
  onStart: () => void
  starting: boolean
}) {
  const rows: { label: string; value: string }[] = []
  if (mode === 'lidarr') {
    rows.push({ label: 'Lidarr', value: form.lidarr.url })
  } else {
    rows.push({ label: 'Mode', value: 'Discovery only' })
  }
  rows.push({
    label: 'AI Provider',
    value: `${form.ai.provider}${form.ai.model ? ` / ${form.ai.model}` : ''}`,
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text">Ready to go</h2>
        <p className="text-sm text-muted mt-1">Here&apos;s what you&apos;ve configured:</p>
        <p className="text-xs text-muted mt-2">
          Personal listening sources are connected per user from Settings after setup.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted">{row.label}</span>
            <span className="text-sm text-text font-medium">{row.value}</span>
          </div>
        ))}
      </div>
      <Button onClick={onStart} disabled={starting} className="w-full" size="lg">
        {starting ? 'Starting...' : 'Start Digging'}
      </Button>
    </div>
  )
}

const DEFAULT_FORM: FormState = {
  lidarr: { url: '', apiKey: '', skipTlsVerify: false },
  ai: { provider: 'anthropic', model: '', apiKey: '', baseUrl: '' },
}

const DEFAULT_RESULTS: TestResults = {
  lidarr: null,
  ai: null,
}

const DEFAULT_TESTING: TestingState = {
  lidarr: false,
  ai: false,
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<SetupMode | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [results, setResults] = useState<TestResults>(DEFAULT_RESULTS)
  const [testing, setTesting] = useState<TestingState>(DEFAULT_TESTING)
  const [starting, setStarting] = useState(false)

  const totalSteps = mode === 'lidarr' ? 4 : 3
  const aiStep = mode === 'lidarr' ? 3 : 2
  const doneStep = mode === 'lidarr' ? 4 : 3

  function setTestingKey(key: keyof TestingState, val: boolean) {
    setTesting((prev) => ({ ...prev, [key]: val }))
  }

  function setResultKey(key: keyof TestResults, val: boolean | null) {
    setResults((prev) => ({ ...prev, [key]: val }))
  }

  async function testLidarr() {
    setTestingKey('lidarr', true)
    try {
      const res = await testService('lidarr', {
        url: form.lidarr.url,
        apiKey: form.lidarr.apiKey,
        skipTlsVerify: form.lidarr.skipTlsVerify,
      })
      if (res.success) {
        setResultKey('lidarr', true)
        toast.success('Lidarr connected successfully')
        setStep(aiStep)
      } else {
        setResultKey('lidarr', false)
        toast.error(res.message || 'Lidarr connection failed')
      }
    } catch {
      setResultKey('lidarr', false)
      toast.error('Could not reach Lidarr')
    } finally {
      setTestingKey('lidarr', false)
    }
  }

  async function testAi() {
    setTestingKey('ai', true)
    const config: Record<string, string> = {
      provider: form.ai.provider,
      model: form.ai.model,
    }
    if (form.ai.provider !== 'ollama' && form.ai.provider !== 'openai-compatible')
      config.apiKey = form.ai.apiKey
    if (form.ai.provider === 'openai-compatible' && form.ai.apiKey) config.apiKey = form.ai.apiKey
    if (form.ai.provider === 'ollama' || form.ai.provider === 'openai-compatible')
      config.baseUrl = form.ai.baseUrl
    try {
      const res = await testService('ai', config)
      if (res.success) {
        setResultKey('ai', true)
        toast.success('AI provider connected')
        setStep(doneStep)
      } else {
        setResultKey('ai', false)
        toast.error(res.message || 'AI provider connection failed')
      }
    } catch {
      setResultKey('ai', false)
      toast.error('Could not reach AI provider')
    } finally {
      setTestingKey('ai', false)
    }
  }

  async function handleStart() {
    setStarting(true)
    const config: Record<string, unknown> = {
      aiProvider: form.ai.provider,
      aiModel: form.ai.model,
      aiApiKey: form.ai.apiKey || null,
      aiBaseUrl: form.ai.baseUrl || null,
    }
    // Only include Lidarr config if mode is lidarr
    if (mode === 'lidarr') {
      config.lidarrUrl = form.lidarr.url
      config.lidarrApiKey = form.lidarr.apiKey
      config.skipTlsVerify = form.lidarr.skipTlsVerify
    }
    try {
      await completeSetup(config)
      onComplete()
    } catch {
      toast.error('Setup failed -- please try again')
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold text-accent">digarr</span>
          <p className="text-muted text-sm mt-1">Initial setup</p>
        </div>

        <StepIndicator current={step} total={totalSteps} />

        <div className="rounded-lg border border-border bg-surface p-6">
          {mode === 'lidarr' && results.lidarr === true && step >= aiStep && (
            <div className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
              <p className="text-sm text-muted">
                Connected. We&apos;ll start syncing your library in the background. The first sync
                may take a while (see Library Health for progress).
              </p>
            </div>
          )}
          {step === 1 && (
            <StepMode
              mode={mode}
              onSelect={(m) => {
                setMode(m)
                setStep(2)
              }}
            />
          )}
          {step === 2 && mode === 'lidarr' && (
            <StepLidarr
              form={form.lidarr}
              onFormChange={(v) => setForm((f) => ({ ...f, lidarr: v }))}
              testing={testing.lidarr}
              onTest={testLidarr}
            />
          )}
          {step === aiStep && (
            <StepAi
              form={form.ai}
              onFormChange={(v) => setForm((f) => ({ ...f, ai: v }))}
              testing={testing.ai}
              onTest={testAi}
            />
          )}
          {step === doneStep && (
            <StepDone
              form={form}
              mode={mode === 'lidarr' ? 'lidarr' : 'discover'}
              onStart={handleStart}
              starting={starting}
            />
          )}
        </div>

        {step > 1 && step < doneStep && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="mt-4 text-sm text-muted hover:text-text"
          >
            &larr; Back
          </button>
        )}
      </div>
    </div>
  )
}

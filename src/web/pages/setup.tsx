import { Compass, MonitorPlay } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field } from '../components/field'
import { LanguageSwitcher } from '../components/language-switcher'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { completeSetup } from '../lib/api'
import { useI18n } from '../lib/i18n'

type FormState = {
  lidarr: { url: string; apiKey: string; skipTlsVerify: boolean }
  emby: { url: string; apiKey: string; userId: string }
  ai: { provider: string; model: string; apiKey: string; baseUrl: string }
}

type SetupMode = 'lidarr' | 'emby' | 'discover'

function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useI18n()
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
                  aria-label={t('setup.stepComplete')}
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
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">{t('setup.howManageMusic')}</h2>
        <p className="text-sm text-muted mt-1">{t('setup.subtitle')}</p>
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
              <p className="text-xs text-muted mt-0.5">{t('setup.lidarrModeDescription')}</p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSelect('emby')}
          className={[
            'w-full text-left rounded-lg border p-4 transition-colors',
            mode === 'emby'
              ? 'border-accent bg-accent/10'
              : 'border-border bg-surface hover:border-accent/50',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
              <MonitorPlay size={18} className="text-accent" />
            </div>
            <div>
              <span className="text-sm font-medium text-text">Emby</span>
              <p className="text-xs text-muted mt-0.5">{t('setup.embyModeDescription')}</p>
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
              <span className="text-sm font-medium text-text">{t('setup.discoveryOnlyLabel')}</span>
              <p className="text-xs text-muted mt-0.5">{t('setup.discoveryModeDescription')}</p>
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
  onContinue,
}: {
  form: FormState['lidarr']
  onFormChange: (v: FormState['lidarr']) => void
  onContinue: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">{t('setup.connectLidarr')}</h2>
        <p className="text-sm text-muted mt-1">{t('setup.lidarrDescription')}</p>
      </div>
      <Field label={t('setup.lidarrUrl')} id="lidarr-url">
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
        {t('setup.skipTlsVerification')}
      </label>
      <Field label={t('setup.apiKey')} id="lidarr-apikey">
        <Input
          id="lidarr-apikey"
          type="password"
          placeholder={t('setup.lidarrApiKeyPlaceholder')}
          value={form.apiKey}
          onChange={(e) => onFormChange({ ...form, apiKey: e.target.value })}
        />
      </Field>
      <p className="text-xs text-muted">{t('setup.connectionTestsContinueLidarr')}</p>
      <Button onClick={onContinue} disabled={!form.url || !form.apiKey} className="w-full">
        {t('common.continue')}
      </Button>
    </div>
  )
}

function StepEmby({
  form,
  onFormChange,
  onContinue,
}: {
  form: FormState['emby']
  onFormChange: (v: FormState['emby']) => void
  onContinue: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text">{t('setup.connectEmby')}</h2>
        <p className="text-sm text-muted mt-1">{t('setup.embyDescription')}</p>
      </div>
      <Field label={t('setup.embyUrl')} id="emby-url">
        <Input
          id="emby-url"
          type="url"
          placeholder="http://localhost:8096"
          value={form.url}
          onChange={(e) => onFormChange({ ...form, url: e.target.value })}
        />
      </Field>
      <Field label={t('setup.apiKey')} id="emby-apikey">
        <Input
          id="emby-apikey"
          type="password"
          placeholder={t('setup.embyApiKeyPlaceholder')}
          value={form.apiKey}
          onChange={(e) => onFormChange({ ...form, apiKey: e.target.value })}
        />
      </Field>
      <Field label={t('setup.userId')} id="emby-userid">
        <Input
          id="emby-userid"
          placeholder={t('setup.embyUserIdPlaceholder')}
          value={form.userId}
          onChange={(e) => onFormChange({ ...form, userId: e.target.value })}
        />
        <p className="text-xs text-muted mt-1">{t('setup.embyUserIdHelp')}</p>
      </Field>
      <p className="text-xs text-muted">{t('setup.connectionTestsContinueEmby')}</p>
      <Button
        onClick={onContinue}
        disabled={!form.url || !form.apiKey || !form.userId}
        className="w-full"
      >
        {t('common.continue')}
      </Button>
    </div>
  )
}

function StepAi({
  form,
  onFormChange,
  onContinue,
}: {
  form: FormState['ai']
  onFormChange: (v: FormState['ai']) => void
  onContinue: () => void
}) {
  const { t } = useI18n()
  const needsApiKey = form.provider !== 'ollama' && form.provider !== 'openai-compatible'
  const apiKeyOptional = form.provider === 'openai-compatible'
  const needsBaseUrl = form.provider === 'ollama' || form.provider === 'openai-compatible'

  const modelSuggestions: Record<string, Array<{ value: string; label: string }>> = {
    anthropic: [
      { value: 'claude-haiku-4-5-20251001', label: t('setup.modelSuggestionAnthropicHaiku') },
      { value: 'claude-sonnet-4-6', label: t('setup.modelSuggestionAnthropicSonnet') },
      { value: 'claude-opus-4-6', label: t('setup.modelSuggestionAnthropicOpus') },
    ],
    openai: [
      { value: 'gpt-5.4-nano', label: t('setup.modelSuggestionOpenAiNano') },
      { value: 'gpt-5.4-mini', label: t('setup.modelSuggestionOpenAiMini') },
      { value: 'gpt-5.4', label: t('setup.modelSuggestionOpenAi') },
    ],
    gemini: [
      { value: 'gemini-3-flash-preview', label: t('setup.modelSuggestionGeminiFlashPreview') },
      { value: 'gemini-2.5-flash', label: t('setup.modelSuggestionGeminiFlash') },
      { value: 'gemini-2.5-pro', label: t('setup.modelSuggestionGeminiPro') },
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
        <h2 className="text-xl font-semibold text-text">{t('setup.aiProvider')}</h2>
        <p className="text-sm text-muted mt-1">{t('setup.aiDescription')}</p>
        <p className="text-xs text-muted mt-2">{t('setup.listeningSourcesLater')}</p>
      </div>
      <Field label={t('setup.provider')} id="ai-provider">
        <Select
          id="ai-provider"
          value={form.provider}
          onChange={(e) => onFormChange({ ...form, provider: e.target.value, model: '' })}
        >
          <option value="anthropic">{t('setup.providerAnthropic')}</option>
          <option value="openai">{t('setup.providerOpenAi')}</option>
          <option value="gemini">{t('setup.providerGemini')}</option>
          <option value="ollama">{t('setup.providerOllama')}</option>
          <option value="openai-compatible">{t('setup.providerOpenAiCompatible')}</option>
        </Select>
      </Field>
      <Field label={t('setup.model')} id="ai-model">
        <Input
          id="ai-model"
          list="ai-model-suggestions"
          placeholder={suggestions[0]?.value ?? t('setup.modelPlaceholder')}
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
              {apiKeyOptional
                ? `${t('setup.apiKey')} (${t('common.optional')})`
                : t('setup.apiKey')}
            </label>
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent underline"
              >
                {t('setup.getApiKey')}
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
        <Field label={t('setup.baseUrl')} id="ai-baseurl">
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
        <p className="text-xs text-muted">{t('setup.openAiCompatibleHint')}</p>
      )}
      <p className="text-xs text-muted">{t('setup.verifyProviderLater')}</p>
      <Button
        onClick={onContinue}
        disabled={!form.model || (needsApiKey && !form.apiKey) || (needsBaseUrl && !form.baseUrl)}
        className="w-full"
      >
        {t('common.continue')}
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
  const { t } = useI18n()
  const rows: { label: string; value: string }[] = []
  if (mode === 'lidarr') {
    rows.push({ label: 'Lidarr', value: form.lidarr.url })
  } else if (mode === 'emby') {
    rows.push({ label: 'Emby', value: form.emby.url })
  } else {
    rows.push({ label: t('setup.mode'), value: t('setup.discoveryOnly') })
  }
  rows.push({
    label: t('setup.aiProvider'),
    value: `${form.ai.provider}${form.ai.model ? ` / ${form.ai.model}` : ''}`,
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text">{t('setup.readyTitle')}</h2>
        <p className="text-sm text-muted mt-1">{t('setup.readyDescription')}</p>
        <p className="text-xs text-muted mt-2">{t('setup.personalSourcesAfterSetup')}</p>
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
        {starting ? t('setup.starting') : t('setup.startDigging')}
      </Button>
    </div>
  )
}

const DEFAULT_FORM: FormState = {
  lidarr: { url: '', apiKey: '', skipTlsVerify: false },
  emby: { url: '', apiKey: '', userId: '' },
  ai: { provider: 'anthropic', model: '', apiKey: '', baseUrl: '' },
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const { locale, setLocale, t } = useI18n()
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<SetupMode | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [starting, setStarting] = useState(false)

  const hasServiceStep = mode === 'lidarr' || mode === 'emby'
  const totalSteps = hasServiceStep ? 4 : 3
  const aiStep = hasServiceStep ? 3 : 2
  const doneStep = hasServiceStep ? 4 : 3

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
    // Only include Emby config if mode is emby
    if (mode === 'emby') {
      config.embyUrl = form.emby.url
      config.embyApiKey = form.emby.apiKey
      config.embyUserId = form.emby.userId
    }
    try {
      await completeSetup(config)
      onComplete()
    } catch {
      toast.error(t('setup.failed'))
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold text-accent">digarr</span>
          <p className="text-muted text-sm mt-1">{t('setup.initialSetup')}</p>
        </div>

        <StepIndicator current={step} total={totalSteps} />

        <div className="rounded-lg border border-border bg-surface p-6">
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
              onContinue={() => setStep(aiStep)}
            />
          )}
          {step === 2 && mode === 'emby' && (
            <StepEmby
              form={form.emby}
              onFormChange={(v) => setForm((f) => ({ ...f, emby: v }))}
              onContinue={() => setStep(aiStep)}
            />
          )}
          {step === aiStep && (
            <StepAi
              form={form.ai}
              onFormChange={(v) => setForm((f) => ({ ...f, ai: v }))}
              onContinue={() => setStep(doneStep)}
            />
          )}
          {step === doneStep && (
            <StepDone
              form={form}
              mode={mode ?? 'discover'}
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
            &larr; {t('setup.back')}
          </button>
        )}

        <div className="mt-4 flex justify-center">
          <LanguageSwitcher value={locale} onChange={setLocale} />
        </div>
      </div>
    </div>
  )
}

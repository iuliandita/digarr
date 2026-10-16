export function SliderField({
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

const LOCAL_AI_DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  'openai-compatible': 'http://localhost:8080',
}

// True when the configured endpoint clearly points back to this machine or a local mDNS host.
// The privacy badge must follow the actual endpoint, not only the selected provider name.
export function isLocalAiProvider(provider: string, baseUrl: string): boolean {
  const defaultBaseUrl = LOCAL_AI_DEFAULT_BASE_URLS[provider]
  if (!defaultBaseUrl) return false
  const effectiveBaseUrl = baseUrl.trim() || defaultBaseUrl
  try {
    const host = new URL(effectiveBaseUrl).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host.endsWith('.local')
    )
  } catch {
    return false
  }
}

export const textareaClass =
  'flex min-h-[5rem] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text shadow-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent font-mono'

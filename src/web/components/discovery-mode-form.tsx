import { useEffect, useMemo, useState } from 'react'
import { errMsg } from '@/core/validation'
import type { DiscoveryConfigField } from '@/core/discovery-modes/types'
import type { DiscoveryModeResponse } from '../lib/api'

type DiscoverySettingsMode = 'easy' | 'advanced'

function getDefaultValue(field: DiscoveryConfigField): boolean | string {
  if (field.type === 'toggle') return false
  if (field.type === 'select') return field.options?.[0]?.value ?? ''
  return ''
}

function getFields(mode: DiscoveryModeResponse, settingsMode: DiscoverySettingsMode) {
  return settingsMode === 'advanced' ? mode.advancedFields : mode.easyFields
}

function normalizeValue(field: DiscoveryConfigField, value: boolean | string): unknown {
  if (field.type === 'toggle') return value === true
  if (field.type === 'number') {
    const trimmed = String(value).trim()
    return trimmed ? Number(trimmed) : undefined
  }
  if (field.type === 'multiselect') {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return String(value).trim()
}

export function DiscoveryModeForm({
  mode,
  onRun,
}: {
  mode: DiscoveryModeResponse
  onRun: (body: Record<string, unknown>) => Promise<void>
}) {
  const [settingsMode, setSettingsMode] = useState<DiscoverySettingsMode>('easy')
  const [values, setValues] = useState<Record<string, boolean | string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fields = useMemo(() => getFields(mode, settingsMode), [mode, settingsMode])

  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev }
      for (const field of [...mode.easyFields, ...mode.advancedFields]) {
        if (!(field.key in next)) {
          next[field.key] = getDefaultValue(field)
        }
      }
      return next
    })
  }, [mode])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedSettings = Object.fromEntries(
      fields
        .map((field) => [field.key, normalizeValue(field, values[field.key] ?? getDefaultValue(field))])
        .filter((entry) => {
          const value = entry[1]
          return value !== undefined
        }),
    )

    for (const field of fields) {
      if (!field.required) continue
      const value = normalizedSettings[field.key]
      if (Array.isArray(value) && value.length > 0) continue
      if (value === true) continue
      if (typeof value === 'number' && !Number.isNaN(value)) continue
      if (typeof value === 'string' && value.length > 0) continue
      setError(`${field.label} is required`)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onRun({
        modeId: mode.id,
        settingsMode,
        rawUserSettings: normalizedSettings,
        normalizedSettings,
        providerContext: { providerPath: mode.availability.providerPath },
        fallbackPolicy: mode.availability.fallbackUsed ? 'allow-fallback' : 'strict',
      })
    } catch (submitError) {
      setError(errMsg(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2">
        {(['easy', 'advanced'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSettingsMode(option)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              settingsMode === option
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-surface text-muted hover:text-text'
            }`}
          >
            {option === 'easy' ? 'Easy' : 'Advanced'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-reject/20 bg-reject/10 px-3 py-2 text-sm text-reject">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field) => {
          const value = values[field.key] ?? getDefaultValue(field)

          return (
            <label key={field.key} className="block space-y-1">
              <span className="block text-sm font-medium text-text">{field.label}</span>
              {field.helpText && <span className="block text-xs text-muted">{field.helpText}</span>}
              {field.type === 'select' ? (
                <select
                  value={String(value)}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'toggle' ? (
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-border"
                />
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={String(value)}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  placeholder={field.type === 'multiselect' ? 'Enter comma-separated values' : ''}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
                />
              )}
            </label>
          )
        })}
      </div>

      <button
        type="submit"
        disabled={!mode.availability.enabled || submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Starting...' : 'Run discovery'}
      </button>
    </form>
  )
}

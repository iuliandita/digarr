import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiscoveryConfigField } from '@/core/discovery-modes/types'
import type { MessageKey } from '@/core/i18n/messages/types'
import { errMsg } from '@/core/validation'
import type { DiscoveryModeResponse } from '../lib/api'
import {
  buildDiscoveryFieldRequiredMessage,
  translateDiscoveryFieldHelp,
  translateDiscoveryFieldLabel,
  translateDiscoveryOption,
} from '../lib/discovery-i18n'
import { useI18n } from '../lib/i18n'

type DiscoverySettingsMode = 'easy' | 'advanced'
type DiscoveryModeIntent = 'run' | 'subscription'

type DiscoveryModeSubscriptionConfig = {
  modeId: string
  settingsMode: DiscoverySettingsMode
  settings: Record<string, unknown>
  providerContext: {
    providerPath: string[]
  }
  fallbackPolicy: 'strict' | 'allow-fallback'
}

type DiscoveryModeFieldValue = boolean | string

function serializeValue(field: DiscoveryConfigField, value: unknown): DiscoveryModeFieldValue {
  if (field.type === 'toggle') return value === true
  if (field.type === 'number') return String(value ?? '')
  if (field.type === 'multiselect') {
    if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
    return String(value ?? '')
  }
  return String(value ?? '')
}

function getDefaultValue(field: DiscoveryConfigField): boolean | string {
  if (field.type === 'toggle') return false
  if (field.type === 'select') return field.options?.[0]?.value ?? ''
  if (field.type === 'tags') return JSON.stringify([{ tag: '', weight: 1 }])
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
  if (field.type === 'tags') {
    try {
      const arr = JSON.parse(String(value))
      if (Array.isArray(arr))
        return arr.filter(
          (r: unknown) =>
            typeof r === 'object' &&
            r !== null &&
            'tag' in r &&
            typeof (r as Record<string, unknown>).tag === 'string' &&
            ((r as Record<string, unknown>).tag as string).trim(),
        )
    } catch {}
    return []
  }
  return String(value).trim()
}

function buildSubmission(
  mode: DiscoveryModeResponse,
  settingsMode: DiscoverySettingsMode,
  values: Record<string, boolean | string>,
  initialSettings: Record<string, unknown> | undefined,
  tFn: (key: MessageKey) => string,
) {
  const fields = getFields(mode, settingsMode)
  const fieldKeys = new Set([...mode.easyFields, ...mode.advancedFields].map((field) => field.key))
  const normalizedSettings = Object.fromEntries(
    fields
      .map((field) => [
        field.key,
        normalizeValue(field, values[field.key] ?? getDefaultValue(field)),
      ])
      .filter((entry) => entry[1] !== undefined),
  ) as Record<string, unknown>
  const preservedSettings = Object.fromEntries(
    Object.entries(initialSettings ?? {}).filter(([key]) => !fieldKeys.has(key)),
  )

  for (const field of fields) {
    if (!field.required) continue
    const value = normalizedSettings[field.key]
    if (Array.isArray(value) && value.length > 0) continue
    if (value === true) continue
    if (typeof value === 'number' && !Number.isNaN(value)) continue
    if (typeof value === 'string' && value.length > 0) continue
    return { error: buildDiscoveryFieldRequiredMessage(tFn, field), payload: null }
  }

  return {
    error: null,
    payload: {
      modeId: mode.id,
      settingsMode,
      settings: { ...preservedSettings, ...normalizedSettings },
      providerContext: { providerPath: mode.availability.providerPath },
      fallbackPolicy: mode.availability.fallbackUsed ? 'allow-fallback' : 'strict',
    } satisfies DiscoveryModeSubscriptionConfig,
  }
}

function TagBuilderField({
  value,
  onChange,
  inputId,
  helpId,
  tFn,
}: {
  value: string
  onChange: (val: string) => void
  inputId: string
  helpId?: string
  tFn: (key: MessageKey) => string
}) {
  type TagRow = { id: number; tag: string; weight: number }

  let counter = 0
  function nextId() {
    counter += 1
    return counter
  }

  function parse(raw: string): TagRow[] {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0)
        return arr.map((r: { tag?: string; weight?: number }) => ({
          id: nextId(),
          tag: typeof r.tag === 'string' ? r.tag : '',
          weight: typeof r.weight === 'number' ? r.weight : 1,
        }))
    } catch {}
    return [{ id: nextId(), tag: '', weight: 1 }]
  }

  function serialize(rows: TagRow[]): string {
    return JSON.stringify(rows.map(({ tag, weight }) => ({ tag, weight })))
  }

  const rows = parse(value)
  const showWeights = rows.length > 1 || (rows.length === 1 && rows[0]?.weight !== 1)

  function updateRow(id: number, updates: Partial<TagRow>) {
    const next = rows.map((r) => (r.id === id ? { ...r, ...updates } : r))
    onChange(serialize(next))
  }

  function addRow() {
    if (rows.length >= 10) return
    onChange(serialize([...rows, { id: nextId(), tag: '', weight: 1 }]))
  }

  function removeRow(id: number) {
    if (rows.length <= 1) return
    onChange(serialize(rows.filter((r) => r.id !== id)))
  }

  return (
    <div id={inputId} aria-describedby={helpId} className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <input
            type="text"
            value={row.tag}
            placeholder={tFn('discoveryMode.tagExamplePlaceholder')}
            onChange={(e) => updateRow(row.id, { tag: e.target.value })}
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {showWeights && (
            <input
              type="number"
              min={1}
              max={10}
              value={row.weight}
              onChange={(e) =>
                updateRow(row.id, {
                  weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                })
              }
              className="w-16 rounded-md border border-border bg-surface px-2 py-2 text-sm text-text focus:border-accent focus:outline-none"
              title={tFn('discoveryMode.tagWeight')}
            />
          )}
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="rounded-md px-2 py-2 text-sm text-muted hover:text-reject"
              title={tFn('discoveryMode.removeTag')}
            >
              x
            </button>
          )}
        </div>
      ))}
      {rows.length < 10 && (
        <button type="button" onClick={addRow} className="text-sm text-accent hover:underline">
          {tFn('discoveryMode.addTag')}
        </button>
      )}
    </div>
  )
}

function DiscoveryModeFields({
  fields,
  values,
  setValues,
  tFn,
}: {
  fields: DiscoveryConfigField[]
  values: Record<string, boolean | string>
  setValues: React.Dispatch<React.SetStateAction<Record<string, boolean | string>>>
  tFn: (key: MessageKey) => string
}) {
  const baseId = useId()

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const value = values[field.key] ?? getDefaultValue(field)
        const inputId = `${baseId}-${field.key}`
        const helpText = translateDiscoveryFieldHelp(tFn, field)
        const helpId = helpText ? `${inputId}-help` : undefined

        return (
          <div key={field.key} className="block space-y-1">
            <label htmlFor={inputId} className="block text-sm font-medium text-text">
              {translateDiscoveryFieldLabel(tFn, field)}
            </label>
            {helpText && (
              <span id={helpId} className="block text-xs text-muted">
                {helpText}
              </span>
            )}
            {field.type === 'select' ? (
              <select
                id={inputId}
                value={String(value)}
                aria-describedby={helpId}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {translateDiscoveryOption(tFn, option)}
                  </option>
                ))}
              </select>
            ) : field.type === 'toggle' ? (
              <input
                id={inputId}
                type="checkbox"
                checked={value === true}
                aria-describedby={helpId}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.key]: event.target.checked }))
                }
                className="h-4 w-4 rounded border-border"
              />
            ) : field.type === 'tags' ? (
              <TagBuilderField
                value={String(value)}
                onChange={(val) => setValues((prev) => ({ ...prev, [field.key]: val }))}
                inputId={inputId}
                helpId={helpId}
                tFn={tFn}
              />
            ) : (
              <input
                id={inputId}
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(value)}
                aria-describedby={helpId}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                placeholder={
                  field.type === 'multiselect' ? tFn('discoveryMode.commaSeparatedValues') : ''
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function DiscoveryModeForm({
  mode,
  onRun,
  onChange,
  intent = 'run',
  initialSettingsMode,
  initialSettings,
}: {
  mode: DiscoveryModeResponse
  onRun: (body: Record<string, unknown>) => Promise<void>
  onChange?: (body: Record<string, unknown> | null) => void
  intent?: DiscoveryModeIntent
  initialSettingsMode?: DiscoverySettingsMode
  initialSettings?: Record<string, unknown>
}) {
  const { t } = useI18n()
  const [settingsMode, setSettingsMode] = useState<DiscoverySettingsMode>(
    initialSettingsMode ?? 'easy',
  )
  const [values, setValues] = useState<Record<string, DiscoveryModeFieldValue>>(() => {
    const next: Record<string, DiscoveryModeFieldValue> = {}
    for (const field of [...mode.easyFields, ...mode.advancedFields]) {
      next[field.key] = getDefaultValue(field)
    }
    if (initialSettings) {
      for (const field of [...mode.easyFields, ...mode.advancedFields]) {
        if (field.key in initialSettings) {
          next[field.key] = serializeValue(field, initialSettings[field.key])
        }
      }
    }
    return next
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  const lastSubscriptionPayloadRef = useRef<string | null>(null)

  const fields = useMemo(() => getFields(mode, settingsMode), [mode, settingsMode])
  const submission = useMemo(
    () => buildSubmission(mode, settingsMode, values, initialSettings, t),
    [mode, settingsMode, values, initialSettings, t],
  )

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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

  useLayoutEffect(() => {
    if (intent !== 'subscription') return
    const payloadSignature = JSON.stringify(submission.payload)
    if (lastSubscriptionPayloadRef.current === payloadSignature) return
    lastSubscriptionPayloadRef.current = payloadSignature
    onChangeRef.current?.(submission.payload)
  }, [intent, submission.payload])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!submission.payload) {
      setError(submission.error)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onRun({
        modeId: mode.id,
        settingsMode: submission.payload.settingsMode,
        rawUserSettings: submission.payload.settings,
        normalizedSettings: submission.payload.settings,
        providerContext: submission.payload.providerContext,
        fallbackPolicy: submission.payload.fallbackPolicy,
      })
    } catch (submitError) {
      setError(errMsg(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <>
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
            {option === 'easy' ? t('discoveryMode.easy') : t('discoveryMode.advanced')}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-reject/20 bg-reject/10 px-3 py-2 text-sm text-reject">
          {error}
        </div>
      )}

      <DiscoveryModeFields fields={fields} values={values} setValues={setValues} tFn={t} />

      {intent === 'run' && (
        <button
          type="submit"
          disabled={!mode.availability.enabled || submitting}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? t('discoveryMode.starting') : t('discoveryMode.runDiscovery')}
        </button>
      )}
    </>
  )

  if (intent === 'subscription') {
    return <div className="space-y-4">{content}</div>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {content}
    </form>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createLidarrTag } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

export function LidarrTags({
  targetId,
  available,
  value,
  onChange,
}: {
  targetId?: number
  available: Array<{ id: number; label: string }>
  value: number[]
  onChange: (tags: number[]) => void
}) {
  const { t } = useI18n()
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [created, setCreated] = useState<Array<{ id: number; label: string }>>([])
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const tags = [
    ...available,
    ...created.filter((tag) => !available.some((item) => item.id === tag.id)),
  ]

  async function create() {
    setSaving(true)
    setError(false)
    try {
      const tag = await createLidarrTag(label.trim(), targetId)
      if (!active.current) return
      setCreated((previous) => [...previous, tag])
      onChange([...new Set([...value, tag.id])])
      setLabel('')
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="space-y-2" disabled={saving}>
      <legend className="text-xs text-muted">{t('lidarr.tags')}</legend>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <label key={tag.id} className="flex gap-1 items-center text-xs text-text">
            <input
              type="checkbox"
              checked={value.includes(tag.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...value, tag.id] : value.filter((id) => id !== tag.id),
                )
              }
            />
            {tag.label}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          aria-label={t('lidarr.newTag')}
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
          className="min-w-0 flex-1 bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || !label.trim()}
          onClick={create}
        >
          {t('lidarr.createTag')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-reject">
          {t('lidarr.tagCreateFailed')}
        </p>
      )}
    </fieldset>
  )
}

import { useEffect, useState } from 'react'
import { errMsg } from '@/core/validation'
import type { PlaylistInsert, PlaylistRow } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { CronPicker } from './cron-picker'

type PlaylistFormProps = {
  playlist?: PlaylistRow
  onSave: (data: PlaylistInsert) => void
  onCancel: () => void
}

const STRATEGIES = [
  {
    value: 'weekly_digest',
    labelKey: 'playlist.strategyWeeklyDigest',
    descriptionKey: 'playlistForm.strategyWeeklyDigestDesc',
  },
  {
    value: 'genre_focus',
    labelKey: 'playlist.strategyGenreFocus',
    descriptionKey: 'playlistForm.strategyGenreFocusDesc',
  },
  {
    value: 'mood_mix',
    labelKey: 'playlist.strategyMoodMix',
    descriptionKey: 'playlistForm.strategyMoodMixDesc',
  },
  {
    value: 'rediscover',
    labelKey: 'playlist.strategyRediscover',
    descriptionKey: 'playlistForm.strategyRediscoverDesc',
  },
] as const

export function PlaylistForm({ playlist, onSave, onCancel }: PlaylistFormProps) {
  const { t } = useI18n()
  const [name, setName] = useState(playlist?.name ?? '')
  const [strategy, setStrategy] = useState(playlist?.strategy ?? 'weekly_digest')
  const [schedule, setSchedule] = useState(playlist?.schedule ?? '0 8 * * 1')
  const [useSchedule, setUseSchedule] = useState(!!playlist?.schedule)
  const [size, setSize] = useState(playlist?.config?.size ?? 25)
  const [genre, setGenre] = useState(playlist?.config?.genre ?? '')
  const [mood, setMood] = useState(playlist?.config?.mood ?? '')
  const [enabled, setEnabled] = useState(playlist?.enabled ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!playlist

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('playlistForm.nameRequired'))
      return
    }
    if (strategy === 'genre_focus' && !genre.trim()) {
      setError(t('playlistForm.genreRequired'))
      return
    }
    if (strategy === 'mood_mix' && !mood.trim()) {
      setError(t('playlistForm.moodRequired'))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const config = {
        size,
        trackSourcePriority: ['local', 'spotify', 'deezer'] as ('local' | 'spotify' | 'deezer')[],
        ...(strategy === 'genre_focus' ? { genre: genre.trim() } : {}),
        ...(strategy === 'mood_mix' ? { mood: mood.trim() } : {}),
      }
      onSave({
        name: name.trim(),
        strategy,
        schedule: useSchedule ? schedule : null,
        config,
        enabled,
      })
    } catch (err: unknown) {
      setError(errMsg(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled via document useEffect above
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? t('playlistForm.dialogEdit') : t('playlistForm.dialogCreate')}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal content panel */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation prevents backdrop dismiss */}
      <div
        className="bg-bg border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text">
            {isEdit ? t('playlistForm.titleEdit') : t('playlistForm.titleCreate')}
          </h2>

          {error && (
            <div className="text-sm text-reject bg-reject/10 border border-reject/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="playlist-name" className="block text-sm font-medium text-text mb-1">
              {t('subscriptionForm.name')}
            </label>
            <input
              id="playlist-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('playlistForm.namePlaceholder')}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* Strategy */}
          <div>
            <label htmlFor="playlist-strategy" className="block text-sm font-medium text-text mb-1">
              {t('playlistForm.strategy')}
            </label>
            <select
              id="playlist-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:border-accent focus:outline-none"
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.labelKey)} - {t(s.descriptionKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Conditional: genre */}
          {strategy === 'genre_focus' && (
            <div>
              <label htmlFor="playlist-genre" className="block text-sm font-medium text-text mb-1">
                {t('subscriptionForm.genre')}
              </label>
              <input
                id="playlist-genre"
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t('subscriptionForm.genrePlaceholder')}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {/* Conditional: mood */}
          {strategy === 'mood_mix' && (
            <div>
              <label htmlFor="playlist-mood" className="block text-sm font-medium text-text mb-1">
                {t('playlistForm.mood')}
              </label>
              <input
                id="playlist-mood"
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder={t('playlistForm.moodPlaceholder')}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {/* Track count */}
          <div>
            <label htmlFor="playlist-size" className="block text-sm font-medium text-text mb-1">
              {t('playlistForm.trackCount')}
            </label>
            <input
              id="playlist-size"
              type="number"
              min={1}
              max={200}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 px-3 py-2 bg-surface border border-border rounded text-sm text-text focus:border-accent focus:outline-none"
            />
          </div>

          {/* Schedule toggle + picker */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="playlist-use-schedule"
                checked={useSchedule}
                onChange={(e) => setUseSchedule(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="playlist-use-schedule" className="text-sm font-medium text-text">
                {t('playlistForm.scheduleAutomaticGeneration')}
              </label>
            </div>
            {useSchedule && (
              <div className="pl-6">
                <CronPicker value={schedule} onChange={setSchedule} />
              </div>
            )}
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="playlist-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="playlist-enabled" className="text-sm text-text">
              {t('common.enabled')}
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted hover:text-text border border-border rounded"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-accent text-accent-fg rounded font-medium hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? t('settings.saving') : isEdit ? t('common.save') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

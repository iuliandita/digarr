import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { getAuthStatus, updateSettings } from '../lib/api'
import { useI18n } from '../lib/i18n'

function formatNextRun(locale: string, nextRun: string): string {
  const diffMinutes = Math.round((new Date(nextRun).getTime() - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffMinutes < 60) return formatter.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return formatter.format(diffHours, 'hour')
  return formatter.format(Math.round(diffHours / 24), 'day')
}

/** Admin switch for the global preferences.playlistEnabled flag (#921). */
export function PlaylistSchedulingToggle({
  enabled,
  nextRun = null,
}: {
  enabled: boolean
  nextRun?: string | null
}) {
  const { locale, t } = useI18n()
  const queryClient = useQueryClient()
  const hintId = useId()
  const [saving, setSaving] = useState(false)
  const { data: authStatus } = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus })
  if (!authStatus?.isAdmin) return null

  async function toggle() {
    setSaving(true)
    try {
      await updateSettings({ preferences: { playlistEnabled: !enabled } })
      // Other Settings forms resend cached preferences; a stale cache would undo this switch.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlists', 'scheduler'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ])
    } catch {
      toast.error(t('playlists.schedulingSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={hintId}
        disabled={saving}
        onClick={toggle}
        className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-text disabled:opacity-50 sm:min-h-0"
      >
        <span
          aria-hidden="true"
          className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? 'bg-approve' : 'bg-border'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform ${enabled ? 'left-4' : 'left-0.5'}`}
          />
        </span>
        {t('playlists.schedulingLabel')}
      </button>
      <p id={hintId} className="text-xs text-muted sm:pt-0.5">
        {!enabled
          ? t('playlists.schedulingPausedHint')
          : nextRun
            ? `${t('playlists.nextGeneration')} ${formatNextRun(locale, nextRun)}`
            : t('playlists.schedulingOnHint')}
      </p>
    </div>
  )
}

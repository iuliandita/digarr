import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { PlaylistCard } from '../components/playlist-card'
import { PlaylistForm } from '../components/playlist-form'
import { Skeleton } from '../components/ui/skeleton'
import {
  createPlaylistApi,
  getPlaylistScheduler,
  getPlaylists,
  type PlaylistInsert,
  type PlaylistRow,
  updatePlaylistApi,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

function getCronLabels(t: (key: MessageKey) => string): Record<string, string> {
  return {
    '0 0 * * *': t('common.daily'),
    '0 6 * * 1': t('common.everyMonday'),
    '0 8 * * 1': t('common.everyMonday'),
    '0 8 * * 0': t('common.everySunday'),
    '0 8 * * 1,4': t('common.monThu'),
    '0 8 1,15 * *': t('common.firstAndFifteenth'),
    '0 8 1 * *': t('common.monthly'),
  }
}

function formatNextRun(locale: string, nextRun: string): string {
  const date = new Date(nextRun)
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffMinutes < 0) return formatter.format(diffMinutes, 'minute')
  if (diffMinutes < 60) return formatter.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return formatter.format(diffHours, 'hour')
  return formatter.format(Math.round(diffHours / 24), 'day')
}

function formatSchedulerSubtitle(info: {
  locale: string
  t: (key: MessageKey) => string
  nextRun: string | null
  cron: string | null
  enabled: boolean
  hasSchedules: boolean
}): string {
  if (info.enabled && info.nextRun) {
    return `${info.t('playlists.nextGeneration')} ${formatNextRun(info.locale, info.nextRun)}`
  }
  if (info.enabled && info.cron) {
    const label = getCronLabels(info.t)[info.cron] ?? info.cron
    return `${info.t('playlists.scheduled')}: ${label}`
  }
  // The scheduler reports one cron only when every playlist shares it.
  if (!info.enabled && (info.cron || info.hasSchedules)) {
    return info.t('playlists.schedulePaused')
  }
  return info.t('playlists.noScheduleConfigured')
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <Skeleton className="h-7 w-24 rounded" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

// PlaylistsPage

export function PlaylistsPage() {
  const { locale, t } = useI18n()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistRow | null>(null)

  const { data: playlists = [], isLoading } = useQuery<PlaylistRow[]>({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  })

  const { data: schedulerInfo } = useQuery<{
    nextRun: string | null
    cron: string | null
    enabled: boolean
  }>({
    queryKey: ['playlists', 'scheduler'],
    queryFn: getPlaylistScheduler,
  })

  useEffect(() => {
    const editId = (location.state as { editId?: number } | null)?.editId
    if (!editId || playlists.length === 0) return

    const playlist = playlists.find((row) => row.id === editId)
    if (!playlist) return

    setEditingPlaylist(playlist)
    setFormMode('edit')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, playlists])

  function openCreate() {
    setEditingPlaylist(null)
    setFormMode('create')
  }

  function openEdit(playlist: PlaylistRow) {
    setEditingPlaylist(playlist)
    setFormMode('edit')
  }

  function closeForm() {
    setFormMode(null)
    setEditingPlaylist(null)
  }

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ['playlists'] })
  }

  async function handleSave(data: PlaylistInsert) {
    try {
      if (formMode === 'edit' && editingPlaylist) {
        await updatePlaylistApi(editingPlaylist.id, data)
        toast.success(t('playlists.updated'))
      } else {
        await createPlaylistApi(data)
        toast.success(t('playlists.created'))
      }
      closeForm()
      refetch()
    } catch {
      toast.error(formMode === 'edit' ? t('playlists.updateFailed') : t('playlists.createFailed'))
    }
  }

  const isEmpty = !isLoading && playlists.length === 0

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-text">{t('playlists.title')}</h1>
          <p className="text-xs text-muted mt-0.5">
            {schedulerInfo
              ? formatSchedulerSubtitle({
                  ...schedulerInfo,
                  hasSchedules: playlists.some((playlist) => playlist.enabled && playlist.schedule),
                  locale,
                  t,
                })
              : t('playlists.automaticDigestGeneration')}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus size={15} aria-hidden="true" />
          {t('playlists.create')}
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <SkeletonGrid />
      ) : isEmpty ? (
        <div className="py-12 text-center space-y-4">
          <p className="text-muted text-sm max-w-sm mx-auto">{t('playlists.empty')}</p>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={15} aria-hidden="true" />
            {t('playlists.create')}
          </button>
          <p className="text-xs text-muted max-w-sm mx-auto">{t('playlists.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {playlists.length}{' '}
              {playlists.length === 1
                ? t('playlists.playlistSingular')
                : t('playlists.playlistPlural')}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                onEdit={() => openEdit(playlist)}
                onRefetch={refetch}
              />
            ))}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      {formMode && (
        <PlaylistForm
          playlist={editingPlaylist ?? undefined}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}
    </div>
  )
}

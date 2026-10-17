import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PlaylistCard } from '../components/playlist-card'
import { PlaylistForm } from '../components/playlist-form'
import { PlaylistSchedulingToggle } from '../components/playlist-scheduling-toggle'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { PageHeader } from '../components/ui/page-header'
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
  const { t } = useI18n()
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
      <PageHeader
        title={t('playlists.title')}
        description={t('playlists.automaticDigestGeneration')}
        actions={
          <Button onClick={openCreate}>
            <Plus size={15} aria-hidden="true" />
            {t('playlists.create')}
          </Button>
        }
      />

      {schedulerInfo && <PlaylistSchedulingToggle enabled={schedulerInfo.enabled} />}

      {/* Content */}
      {isLoading ? (
        <SkeletonGrid />
      ) : isEmpty ? (
        <EmptyState
          className="py-12"
          message={t('playlists.empty')}
          action={
            <>
              <Button onClick={openCreate}>
                <Plus size={15} aria-hidden="true" />
                {t('playlists.create')}
              </Button>
              <p className="text-xs text-muted max-w-sm mx-auto">{t('playlists.emptyHint')}</p>
            </>
          }
        />
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

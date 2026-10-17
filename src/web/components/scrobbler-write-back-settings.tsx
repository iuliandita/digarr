import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { errMsg } from '@/core/validation'
import {
  getScrobblerWriteBackStatus,
  getUserPreferences,
  initiateOAuth,
  updateUserPreferences,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

type Preference = 'listenbrainzLoveEnabled' | 'listenbrainzPlaylistEnabled' | 'lastfmLoveEnabled'

export function ScrobblerWriteBackSettings() {
  const { t } = useI18n()
  const client = useQueryClient()
  const preferences = useQuery({ queryKey: ['user-preferences'], queryFn: getUserPreferences })
  const status = useQuery({
    queryKey: ['scrobbler-write-back'],
    queryFn: getScrobblerWriteBackStatus,
  })
  const [saving, setSaving] = useState(false)

  async function connectLastFm() {
    setSaving(true)
    try {
      const { authUrl } = await initiateOAuth('lastfm', {})
      window.location.assign(authUrl)
    } catch (error) {
      toast.error(errMsg(error))
    } finally {
      setSaving(false)
    }
  }

  async function change(preference: Preference, enabled: boolean) {
    if (preference === 'lastfmLoveEnabled' && enabled && !status.data?.lastfm.connected) {
      await connectLastFm()
      return
    }
    setSaving(true)
    try {
      await updateUserPreferences({ [preference]: enabled })
      client.setQueryData(['user-preferences'], (old: Record<string, unknown> | undefined) => ({
        ...old,
        [preference]: enabled,
      }))
    } catch (error) {
      toast.error(errMsg(error))
    } finally {
      setSaving(false)
    }
  }

  function toggle(preference: Preference, label: MessageKey, configured: boolean) {
    const checked = preferences.data?.[preference] === true
    return (
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={checked}
          disabled={saving || (!configured && !checked)}
          onChange={(event) => void change(preference, event.target.checked)}
        />
        <span>{t(label)}</span>
      </label>
    )
  }

  const error = preferences.error ?? status.error

  return (
    <section className="space-y-3">
      <h2 className="text-lead font-semibold text-text">{t('writeBack.title')}</h2>
      <p className="text-xs text-muted">{t('writeBack.scope')}</p>
      <p className="text-xs text-muted">{t('writeBack.offHelp')}</p>
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-reject">
          <p>{t('writeBack.loadFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void preferences.refetch()
              void status.refetch()
            }}
          >
            {t('errorBoundary.retry')}
          </Button>
        </div>
      ) : !preferences.data || !status.data ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {toggle(
              'listenbrainzLoveEnabled',
              'writeBack.listenbrainzLoves',
              status.data.listenbrainz.configured,
            )}
            <p className="text-xs text-muted">{t('writeBack.listenbrainzHelp')}</p>
            {toggle(
              'listenbrainzPlaylistEnabled',
              'writeBack.listenbrainzPlaylists',
              status.data.listenbrainz.configured,
            )}
            <p className="text-xs text-muted">{t('writeBack.playlistHelp')}</p>
            {!status.data.listenbrainz.configured && (
              <p className="text-xs text-muted">{t('writeBack.listenbrainzMissing')}</p>
            )}
            {status.data.listenbrainz.lastError && (
              <p role="status" className="text-xs text-reject">
                {t('writeBack.lastError').replace('{0}', status.data.listenbrainz.lastError)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            {toggle('lastfmLoveEnabled', 'writeBack.lastfmLoves', status.data.lastfm.configured)}
            <p className="text-xs text-muted">{t('writeBack.lastfmHelp')}</p>
            {!status.data.lastfm.configured ? (
              <p className="text-xs text-muted">{t('writeBack.lastfmMissing')}</p>
            ) : (
              <p className="text-xs text-muted">
                {t(
                  status.data.lastfm.connected
                    ? 'writeBack.lastfmConnected'
                    : 'writeBack.lastfmConnect',
                )}
              </p>
            )}
            {status.data.lastfm.configured && status.data.lastfm.connected && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void connectLastFm()}
              >
                {t('writeBack.lastfmReconnect')}
              </Button>
            )}
            {status.data.lastfm.lastError && (
              <p role="status" className="text-xs text-reject">
                {t('writeBack.lastError').replace('{0}', status.data.lastfm.lastError)}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Field } from '../../components/field'
import { Hint } from '../../components/hint'
import { PlaylistSchedulingToggle } from '../../components/playlist-scheduling-toggle'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Input } from '../../components/ui/input'
import {
  getPlaylistScheduler,
  getPlaylists,
  getSchedulerInfo,
  getSubscriptions,
  updateSettings,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import type { Settings } from './types'

type CronPreset = { label: string; value: string }

const PRESETS: CronPreset[] = [
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
  { label: 'Biweekly', value: '0 0 1,15 * *' },
  { label: 'Monthly', value: '0 0 1 * *' },
]

function ScheduleRow({
  name,
  schedule,
  status,
  action,
}: {
  name: string
  schedule: string
  status?: ReactNode
  action?: ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-0">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-text break-words">{name}</p>
        <p className="font-mono text-xs text-muted break-all">{schedule}</p>
        {status && <p className="text-xs text-muted">{status}</p>}
      </div>
      {action}
    </li>
  )
}

export function ScheduleTab({
  settings,
  onSaved,
  isAdmin = false,
}: {
  settings: Settings
  onSaved: () => void
  isAdmin?: boolean
}) {
  const { locale, t } = useI18n()
  const prefs = settings.preferences ?? {}
  const [cron, setCron] = useState(prefs.scheduleCron ?? '0 0 * * 0')
  const [digestCron, setDigestCron] = useState(prefs.digestCron ?? '')
  const [librarySyncIntervalHours, setLibrarySyncIntervalHours] = useState(
    String(settings.librarySyncIntervalHours ?? 6),
  )
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(!PRESETS.some((p) => p.value === cron))
  const subscriptions = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: getPlaylists })
  const scheduler = useQuery({
    queryKey: ['scheduler-info'],
    queryFn: getSchedulerInfo,
    refetchInterval: 60_000,
  })
  const playlistScheduler = useQuery({
    queryKey: ['playlists', 'scheduler'],
    queryFn: getPlaylistScheduler,
    refetchInterval: 60_000,
  })
  const overviewFailed =
    subscriptions.isError || playlists.isError || scheduler.isError || playlistScheduler.isError
  const linkClass = 'shrink-0 text-sm text-accent-text underline underline-offset-2 focus-ring'

  function editSchedule(name: string) {
    return isAdmin ? (
      <button
        type="button"
        className={linkClass}
        aria-label={`${t('common.edit')}: ${name}`}
        onClick={() => {
          setAdvancedOpen(true)
          document.getElementById('schedule-editor')?.scrollIntoView?.({ block: 'start' })
        }}
      >
        {t('common.edit')}
      </button>
    ) : null
  }

  const presetLabels: Record<string, string> = {
    Daily: t('settings.daily'),
    Weekly: t('settings.weekly'),
    Biweekly: t('settings.biweekly'),
    Monthly: t('settings.monthly'),
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({
        // '' (not undefined) so clearing the field actually disables the digest server-side.
        preferences: { ...prefs, scheduleCron: cron, digestCron: digestCron.trim() },
        librarySyncIntervalHours: Number.parseInt(librarySyncIntervalHours, 10) || 6,
      })
      toast.success(t('settings.scheduleSaved'))
      onSaved()
    } catch {
      toast.error(t('settings.scheduleFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="space-y-4" aria-labelledby="schedule-overview-title">
        <div className="space-y-1">
          <h2 id="schedule-overview-title" className="text-lead font-semibold text-text">
            {t('settings.scheduleOverview')}
          </h2>
          <p className="text-sm text-muted">{t('settings.scheduleOverviewHelp')}</p>
        </div>
        {overviewFailed && (
          <p role="alert" className="text-sm text-reject">
            {t('settings.scheduleOverviewFailed')}
          </p>
        )}
        <ul className="rounded-lg border border-border bg-surface px-4">
          <ScheduleRow
            name={t('settings.scanSchedule')}
            schedule={(prefs.scheduleCron ?? '0 0 * * 0') || t('common.disabled')}
            action={editSchedule(t('settings.scanSchedule'))}
          />
          <ScheduleRow
            name={t('settings.digestSchedule')}
            schedule={prefs.digestCron || t('common.disabled')}
            action={editSchedule(t('settings.digestSchedule'))}
          />
          {isAdmin && (
            <ScheduleRow
              name={t('settings.librarySyncInterval')}
              schedule={t('settings.librarySyncEvery').replace(
                '{hours}',
                String(settings.librarySyncIntervalHours ?? 6),
              )}
              action={editSchedule(t('settings.librarySyncInterval'))}
            />
          )}
        </ul>

        <section className="space-y-2" aria-labelledby="subscription-schedules-title">
          <div className="flex items-center justify-between gap-3">
            <h3 id="subscription-schedules-title" className="font-semibold text-text">
              {t('discover.discoveryModes')}
            </h3>
            <Link to="/discovery-modes" className={linkClass}>
              {t('common.edit')}
            </Link>
          </div>
          {subscriptions.isPending ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : subscriptions.data?.length === 0 ? (
            <p className="text-sm text-muted">{t('common.none')}</p>
          ) : null}
          {!!subscriptions.data?.length && (
            <ul className="rounded-lg border border-border bg-surface px-4">
              {subscriptions.data.map((subscription) => {
                const nextRun = scheduler.data?.jobs.find(
                  (job) => job.name === `subscription-${subscription.id}`,
                )?.nextRun
                return (
                  <ScheduleRow
                    key={subscription.id}
                    name={subscription.name}
                    schedule={subscription.cron}
                    status={
                      <>
                        {subscription.enabled ? t('common.enabled') : t('settings.schedulePaused')}
                        {subscription.enabled && nextRun && (
                          <>
                            {' '}
                            - {t('subscriptions.nextRun')}{' '}
                            {new Date(nextRun).toLocaleString(locale)}
                          </>
                        )}
                      </>
                    }
                    action={
                      <Link
                        to={`/discovery-modes?subscription=${subscription.id}`}
                        className={linkClass}
                        aria-label={`${t('common.edit')}: ${subscription.name}`}
                      >
                        {t('common.edit')}
                      </Link>
                    }
                  />
                )
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="playlist-schedules-title">
          <h3 id="playlist-schedules-title" className="font-semibold text-text">
            {t('playlists.title')}
          </h3>
          {playlistScheduler.data && (
            <PlaylistSchedulingToggle
              enabled={playlistScheduler.data.enabled}
              nextRun={playlistScheduler.data.nextRun}
            />
          )}
          {playlists.isPending ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : playlists.data?.length === 0 ? (
            <p className="text-sm text-muted">{t('common.none')}</p>
          ) : null}
          {!!playlists.data?.length && (
            <ul className="rounded-lg border border-border bg-surface px-4">
              {playlists.data.map((playlist) => (
                <ScheduleRow
                  key={playlist.id}
                  name={playlist.name}
                  schedule={playlist.schedule || t('common.manual')}
                  status={
                    playlist.schedule && playlistScheduler.data
                      ? playlistScheduler.data.enabled
                        ? t('common.enabled')
                        : t('settings.schedulePaused')
                      : undefined
                  }
                  action={
                    <Link
                      to="/playlists"
                      state={{ editId: playlist.id }}
                      className={linkClass}
                      aria-label={`${t('common.edit')}: ${playlist.name}`}
                    >
                      {t('common.edit')}
                    </Link>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </section>

      {isAdmin && (
        <section id="schedule-editor" className="space-y-6 max-w-lg">
          <h2 className="text-lead font-semibold text-text">{t('settings.editSchedules')}</h2>
          <Hint id="settings-schedule-tip" type="inline">
            {t('settings.scheduleTip')}
          </Hint>

          <section className="space-y-3">
            <h2 className="text-lead font-semibold text-text">{t('settings.presets')}</h2>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.value}
                  variant={cron === p.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCron(p.value)}
                >
                  {presetLabels[p.label] ?? p.label}
                </Button>
              ))}
            </div>
          </section>

          <Disclosure
            title={t('settings.advancedSettings')}
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
          >
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-body font-medium text-text">{t('settings.customCron')}</h3>
                <Field label={t('settings.cronExpression')} id="cron-expr">
                  <Input
                    id="cron-expr"
                    placeholder="0 0 * * *"
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                    className="font-mono"
                  />
                </Field>
              </section>

              <section className="space-y-2">
                <h3 className="text-body font-medium text-text">
                  {t('settings.librarySyncInterval')}
                </h3>
                <Field
                  label={t('settings.librarySyncIntervalHours')}
                  id="library-sync-interval-hours"
                >
                  <Input
                    id="library-sync-interval-hours"
                    type="number"
                    min="1"
                    max="24"
                    value={librarySyncIntervalHours}
                    onChange={(e) => setLibrarySyncIntervalHours(e.target.value)}
                  />
                </Field>
                <p className="text-xs text-muted">{t('settings.librarySyncIntervalHelp')}</p>
              </section>

              <section className="space-y-2">
                <Field label={t('settings.fieldDigestCron')} id="digest-cron">
                  <Input
                    id="digest-cron"
                    placeholder="0 6 * * 1"
                    value={digestCron}
                    onChange={(e) => setDigestCron(e.target.value)}
                    className="font-mono"
                  />
                </Field>
                <p className="text-xs text-muted">{t('settings.digestCronHelp')}</p>
              </section>
            </div>
          </Disclosure>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </section>
      )}
    </div>
  )
}

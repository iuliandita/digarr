import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import type { NotificationChannel, NotificationEvent } from '@/core/notifications/types'
import { Field } from '../../components/field'
import { ServiceCard } from '../../components/service-card'
import { WebhookIcon } from '../../components/service-icons'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { ApiError, testNotificationChannel, updateSettings } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { textareaClass } from './shared'
import type { Settings } from './types'

const CHANNEL_TYPES = ['webhook', 'ntfy', 'telegram', 'apprise'] as const

type ChannelType = (typeof CHANNEL_TYPES)[number]

const CHANNEL_TYPE_LABEL: Record<ChannelType, MessageKey> = {
  webhook: 'settings.channels.typeWebhook',
  ntfy: 'settings.channels.typeNtfy',
  telegram: 'settings.channels.typeTelegram',
  apprise: 'settings.channels.typeApprise',
}

function makeChannel(type: ChannelType): NotificationChannel {
  const base = {
    id: crypto.randomUUID(),
    enabled: true,
    events: ['batch_complete', 'digest'] as NotificationEvent[],
  }
  switch (type) {
    case 'webhook':
      return { ...base, type, url: '' }
    case 'ntfy':
      return { ...base, type, server: '', topic: '' }
    case 'telegram':
      return { ...base, type, botToken: '', chatId: '' }
    case 'apprise':
      return { ...base, type, endpoint: '', urls: '' }
  }
}

// Per-type secret fields, mirroring the backend's CHANNEL_SECRET_FIELDS.
const CHANNEL_SECRET_FIELDS: Record<ChannelType, readonly string[]> = {
  webhook: [],
  ntfy: ['token'],
  telegram: ['botToken'],
  apprise: ['urls'],
}

function secretKey(channelId: string, field: string): string {
  return `${channelId}:${field}`
}

// The API returns set secrets masked as '***'. Strip them to empty inputs (like the
// sibling connection fields do for lidarrApiKey etc.) and remember which were set.
function stripSecrets(channels: NotificationChannel[]): NotificationChannel[] {
  return channels.map((channel) => {
    const copy = { ...channel } as Record<string, unknown>
    for (const f of CHANNEL_SECRET_FIELDS[channel.type]) {
      if (copy[f] === '***') copy[f] = ''
    }
    return copy as NotificationChannel
  })
}

function computeHadSecret(channels: NotificationChannel[]): Record<string, boolean> {
  const had: Record<string, boolean> = {}
  for (const channel of channels) {
    for (const f of CHANNEL_SECRET_FIELDS[channel.type]) {
      if ((channel as Record<string, unknown>)[f] === '***') had[secretKey(channel.id, f)] = true
    }
  }
  return had
}

// Rebuild outgoing secrets before Save/Test: a blank input on a channel that already
// had a stored secret round-trips as '***' (backend restores the stored ciphertext);
// a non-empty input sends the new plaintext; a blank input on a brand-new channel
// stays blank. This avoids appending to the '***' placeholder (apprise multiline).
function applyStoredSecrets(
  channel: NotificationChannel,
  hadSecret: Record<string, boolean>,
): NotificationChannel {
  const copy = { ...channel } as Record<string, unknown>
  for (const f of CHANNEL_SECRET_FIELDS[channel.type]) {
    if (copy[f] === '' && hadSecret[secretKey(channel.id, f)]) copy[f] = '***'
  }
  return copy as NotificationChannel
}

function ChannelFields({
  channel,
  onPatch,
  hadSecret,
  t,
}: {
  channel: NotificationChannel
  onPatch: (patch: Record<string, unknown>) => void
  hadSecret: Record<string, boolean>
  t: (key: MessageKey) => string
}) {
  const keepPlaceholder = (field: string) =>
    hadSecret[secretKey(channel.id, field)]
      ? t('settings.channels.secretKeepPlaceholder')
      : undefined
  switch (channel.type) {
    case 'webhook':
      return (
        <Field label={t('settings.channels.webhookUrl')} id={`ch-${channel.id}-url`}>
          <Input
            id={`ch-${channel.id}-url`}
            type="url"
            placeholder="https://example.com/digarr-webhook"
            value={channel.url}
            onChange={(e) => onPatch({ url: e.target.value })}
          />
        </Field>
      )
    case 'ntfy':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('settings.channels.ntfyServer')} id={`ch-${channel.id}-server`}>
            <Input
              id={`ch-${channel.id}-server`}
              type="url"
              placeholder="https://ntfy.sh"
              value={channel.server}
              onChange={(e) => onPatch({ server: e.target.value })}
            />
          </Field>
          <Field label={t('settings.channels.ntfyTopic')} id={`ch-${channel.id}-topic`}>
            <Input
              id={`ch-${channel.id}-topic`}
              value={channel.topic}
              onChange={(e) => onPatch({ topic: e.target.value })}
            />
          </Field>
          <Field label={t('settings.channels.ntfyToken')} id={`ch-${channel.id}-token`}>
            <Input
              id={`ch-${channel.id}-token`}
              type="password"
              placeholder={keepPlaceholder('token')}
              value={channel.token ?? ''}
              onChange={(e) => onPatch({ token: e.target.value })}
            />
          </Field>
        </div>
      )
    case 'telegram':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('settings.channels.telegramBotToken')} id={`ch-${channel.id}-bot`}>
            <Input
              id={`ch-${channel.id}-bot`}
              type="password"
              placeholder={keepPlaceholder('botToken')}
              value={channel.botToken}
              onChange={(e) => onPatch({ botToken: e.target.value })}
            />
          </Field>
          <Field label={t('settings.channels.telegramChatId')} id={`ch-${channel.id}-chat`}>
            <Input
              id={`ch-${channel.id}-chat`}
              value={channel.chatId}
              onChange={(e) => onPatch({ chatId: e.target.value })}
            />
          </Field>
        </div>
      )
    case 'apprise':
      return (
        <div className="space-y-3">
          <Field label={t('settings.channels.appriseEndpoint')} id={`ch-${channel.id}-endpoint`}>
            <Input
              id={`ch-${channel.id}-endpoint`}
              type="url"
              placeholder="https://apprise.example.com/notify"
              value={channel.endpoint}
              onChange={(e) => onPatch({ endpoint: e.target.value })}
            />
          </Field>
          <Field label={t('settings.channels.appriseUrls')} id={`ch-${channel.id}-urls`}>
            <textarea
              id={`ch-${channel.id}-urls`}
              className={textareaClass}
              placeholder={keepPlaceholder('urls')}
              value={channel.urls}
              onChange={(e) => onPatch({ urls: e.target.value })}
            />
          </Field>
          <p className="text-xs text-muted">{t('settings.channels.appriseUrlsHelp')}</p>
        </div>
      )
    default: {
      const _exhaustive: never = channel
      return _exhaustive
    }
  }
}

export function NotificationChannelsCard({
  settings,
  isAdmin,
  onSaved,
}: {
  settings: Settings
  isAdmin: boolean
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [channels, setChannels] = useState<NotificationChannel[]>(() =>
    stripSecrets((settings.preferences?.channels ?? []) as NotificationChannel[]),
  )
  const [hadSecret] = useState<Record<string, boolean>>(() =>
    computeHadSecret((settings.preferences?.channels ?? []) as NotificationChannel[]),
  )
  const [digestCron, setDigestCron] = useState(settings.preferences?.digestCron ?? '')
  const [addType, setAddType] = useState<ChannelType>('webhook')
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  function patchChannel(id: string, patch: Record<string, unknown>) {
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? ({ ...c, ...patch } as NotificationChannel) : c)),
    )
  }

  function toggleEvent(id: string, event: NotificationEvent) {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const has = c.events.includes(event)
        return { ...c, events: has ? c.events.filter((e) => e !== event) : [...c.events, event] }
      }),
    )
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({
        preferences: {
          ...(settings.preferences ?? {}),
          channels: channels.map((c) => applyStoredSecrets(c, hadSecret)),
          // '' (not undefined) so clearing the field actually disables the digest server-side.
          digestCron: digestCron.trim(),
        },
      })
      toast.success(t('settings.channels.saved'))
      onSaved()
    } catch {
      toast.error(t('settings.channels.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(channel: NotificationChannel) {
    setTestingId(channel.id)
    try {
      await testNotificationChannel(applyStoredSecrets(channel, hadSecret))
      toast.success(t('settings.channels.testOk'))
    } catch (err) {
      let detail = ''
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        const d = (err.data as Record<string, unknown>).detail
        if (typeof d === 'string' && d.trim()) detail = d.trim()
      }
      toast.error(
        t('settings.channels.testFailed').replace('{0}', detail || t('common.unknownError')),
      )
    } finally {
      setTestingId(null)
    }
  }

  // The backend strips channels from GET and 403s Save/Test for non-admins, so an
  // editable card would be dead. Render nothing for them (the outer tab already
  // shows an admin-only notice).
  if (!isAdmin) return null

  return (
    <ServiceCard
      name={t('settings.channels.title')}
      description={t('settings.channels.description')}
      status={(settings.preferences?.channels?.length ?? 0) > 0 ? 'saved' : 'not_configured'}
      icon={<WebhookIcon />}
    >
      {channels.length === 0 && (
        <p className="text-sm text-muted">{t('settings.channels.empty')}</p>
      )}

      <div className="space-y-4">
        {channels.map((channel) => (
          <div key={channel.id} className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline">{t(CHANNEL_TYPE_LABEL[channel.type])}</Badge>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={channel.enabled}
                    onChange={(e) => patchChannel(channel.id, { enabled: e.target.checked })}
                    className="rounded border-border"
                  />
                  {t('settings.channels.enabled')}
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChannels((prev) => prev.filter((c) => c.id !== channel.id))}
                >
                  {t('settings.channels.remove')}
                </Button>
              </div>
            </div>

            <ChannelFields
              channel={channel}
              t={t}
              hadSecret={hadSecret}
              onPatch={(patch) => patchChannel(channel.id, patch)}
            />

            <div className="space-y-1.5">
              <span className="text-sm text-muted">{t('settings.channels.events')}</span>
              <div className="flex flex-wrap gap-4">
                {(['batch_complete', 'digest'] as NotificationEvent[]).map((event) => (
                  <label key={event} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={channel.events.includes(event)}
                      onChange={() => toggleEvent(channel.id, event)}
                      className="rounded border-border"
                    />
                    {event === 'batch_complete'
                      ? t('settings.channels.eventBatch')
                      : t('settings.channels.eventDigest')}
                  </label>
                ))}
              </div>
            </div>

            <Disclosure
              title={
                <span>
                  {t('settings.advancedSettings')}
                  <span className="sr-only"> ({t(CHANNEL_TYPE_LABEL[channel.type])})</span>
                </span>
              }
            >
              <div className="space-y-3">
                {channel.type === 'ntfy' && (
                  <Field
                    label={t('settings.channels.ntfyPriority')}
                    id={`ch-${channel.id}-priority`}
                  >
                    <Select
                      id={`ch-${channel.id}-priority`}
                      value={channel.priority != null ? String(channel.priority) : ''}
                      onChange={(e) =>
                        patchChannel(channel.id, {
                          priority: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    >
                      <option value="">{t('settings.channels.ntfyPriorityDefault')}</option>
                      {[1, 2, 3, 4, 5].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={channel.allowPrivateTarget ?? false}
                    onChange={(e) =>
                      patchChannel(channel.id, { allowPrivateTarget: e.target.checked })
                    }
                    className="rounded border-border"
                  />
                  {t('settings.channels.allowPrivate')}
                </label>
              </div>
            </Disclosure>
            {channel.allowPrivateTarget && (
              <p className="text-xs text-warning">{t('settings.channels.allowPrivateWarning')}</p>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleTest(channel)}
                disabled={testingId === channel.id}
              >
                {testingId === channel.id ? t('settings.sending') : t('settings.channels.test')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('settings.channels.type')} id="add-channel-type">
          <Select
            id="add-channel-type"
            value={addType}
            onChange={(e) => setAddType(e.target.value as ChannelType)}
            className="w-auto"
          >
            {CHANNEL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(CHANNEL_TYPE_LABEL[type])}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setChannels((prev) => [...prev, makeChannel(addType)])}
        >
          {t('settings.channels.add')}
        </Button>
      </div>

      <Disclosure title={t('settings.advancedSettings')}>
        <Field label={t('settings.fieldDigestCron')} id="digest-cron">
          <Input
            id="digest-cron"
            placeholder="0 6 * * 1"
            value={digestCron}
            onChange={(e) => setDigestCron(e.target.value)}
          />
        </Field>
        <p className="mt-1 text-xs text-muted">{t('settings.digestCronHelp')}</p>
      </Disclosure>

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>
    </ServiceCard>
  )
}

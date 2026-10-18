import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Hint } from '../../components/hint'
import { LidarrTags } from '../../components/lidarr-tags'
import { Button } from '../../components/ui/button'
import {
  createTargetApi,
  deleteTargetApi,
  getCurrentUser,
  getLidarrApproveOptions,
  listTargets,
  listUsers,
  testTargetApi,
  updateTargetApi,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'

type AddTargetField =
  | {
      kind?: 'input'
      key: string
      label: string
      placeholder: string
      type?: 'password' | 'url' | 'text' | 'number'
      min?: number
      max?: number
    }
  | {
      kind: 'select'
      key: string
      label: string
      options: Array<{ value: string; label: string }>
    }

type AddTargetType = {
  value: string
  label: string
  fields: AddTargetField[]
  // Created by a provider connection, not from this form; still editable.
  creatable?: false
}

function getTargetTypes(
  t: ReturnType<typeof useI18n>['t'],
  lidarrTargets: Array<{ id: number; name: string }>,
): AddTargetType[] {
  const lidarrTargetLabel = `${t('settings.targetTypeLidarr')} ${t('jobHistory.targetType')}`

  return [
    {
      value: 'lidarr',
      label: t('settings.targetTypeLidarr'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://lidarr:8686',
          type: 'url',
        },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKeyOptional'),
          type: 'password',
        },
      ],
    },
    {
      value: 'slskd',
      label: t('settings.targetTypeSlskd'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://slskd:5030',
          type: 'url',
        },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKeyOptional'),
          type: 'password',
        },
        {
          kind: 'select',
          key: 'lidarrTargetId',
          label: lidarrTargetLabel,
          options: [
            { value: '', label: t('common.none') },
            ...lidarrTargets.map((target) => ({
              value: String(target.id),
              label: target.name,
            })),
          ],
        },
        {
          key: 'searchIntervalSeconds',
          label: t('settings.slskdSearchInterval'),
          placeholder: '3',
          type: 'number',
          min: 1,
          max: 60,
        },
        {
          key: 'lidarrDownloadPath',
          label: t('settings.slskdLidarrDownloadPath'),
          placeholder: '/downloads',
        },
      ],
    },
    {
      value: 'emby-playlist',
      label: t('settings.targetTypeEmbyPlaylist'),
      fields: [
        { key: 'url', label: t('settings.fieldUrl'), placeholder: 'http://emby:8096', type: 'url' },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKey'),
          type: 'password',
        },
        { key: 'userId', label: t('settings.fieldUserId'), placeholder: t('settings.fieldUserId') },
      ],
    },
    {
      value: 'jellyfin-playlist',
      label: t('settings.targetTypeJellyfinPlaylist'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://jellyfin:8096',
          type: 'url',
        },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKey'),
          type: 'password',
        },
        { key: 'userId', label: t('settings.fieldUserId'), placeholder: t('settings.fieldUserId') },
      ],
    },
    {
      value: 'plex-playlist',
      label: t('settings.targetTypePlexPlaylist'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://plex:32400',
          type: 'url',
        },
        {
          key: 'token',
          label: t('settings.plexToken'),
          placeholder: t('settings.plexToken'),
          type: 'password',
        },
      ],
    },
    {
      value: 'navidrome-playlist',
      label: t('settings.targetTypeNavidromePlaylist'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://navidrome:4533',
          type: 'url',
        },
        {
          key: 'username',
          label: t('settings.fieldUsername'),
          placeholder: t('settings.fieldUsername'),
        },
        {
          key: 'password',
          label: t('settings.fieldPassword'),
          placeholder: t('settings.fieldPassword'),
          type: 'password',
        },
      ],
    },
    {
      value: 'spotify-playlist',
      label: t('settings.targetTypeSpotifyPlaylist'),
      fields: [],
      creatable: false,
    },
  ]
}

function TargetTypeIcon({ type }: { type: string }) {
  const iconMap: Record<string, string> = {
    lidarr: '/icons/lidarr.png',
    'emby-playlist': '/icons/emby.svg',
    'jellyfin-playlist': '/icons/jellyfin.svg',
    'plex-playlist': '/icons/plex.svg',
    'navidrome-playlist': '/icons/subsonic.svg',
    jellyfin: '/icons/jellyfin.svg',
    'spotify-playlist': '/icons/spotify.svg',
  }
  const src = iconMap[type]
  if (src) return <img src={src} alt="" className="w-5 h-5" />
  return (
    <span className="w-5 h-5 rounded bg-accent text-accent-fg text-micro font-bold flex items-center justify-center uppercase">
      {type.charAt(0)}
    </span>
  )
}

function normalizeTargetConfig(
  type: string,
  config: Record<string, string>,
): Record<string, unknown> {
  const normalizedEntries = Object.entries(config).filter(([, value]) => value !== '')
  const normalizedConfig = Object.fromEntries(normalizedEntries) as Record<string, unknown>

  if (type === 'slskd' && 'searchIntervalSeconds' in config) {
    normalizedConfig.searchIntervalSeconds = Number(config.searchIntervalSeconds || 3)
  }
  if (type === 'slskd' && config.lidarrTargetId === '') normalizedConfig.lidarrTargetId = null
  if (type === 'slskd' && typeof normalizedConfig.lidarrTargetId === 'string') {
    const lidarrTargetId = Number.parseInt(normalizedConfig.lidarrTargetId, 10)
    if (Number.isFinite(lidarrTargetId)) {
      normalizedConfig.lidarrTargetId = lidarrTargetId
    } else {
      delete normalizedConfig.lidarrTargetId
    }
  }

  return normalizedConfig
}

// The server merges PATCH config into the stored one, so an edit sends only the
// fields this form renders; stored non-string values (skipTlsVerify) stay typed.
function buildTargetConfigPatch(
  targetType: AddTargetType,
  config: Record<string, string>,
): Record<string, unknown> | undefined {
  if (targetType.fields.length === 0) return undefined
  const editable = new Set(targetType.fields.map((field) => field.key))
  return normalizeTargetConfig(
    targetType.value,
    Object.fromEntries(Object.entries(config).filter(([key]) => editable.has(key))),
  )
}

const LIDARR_DEFAULT_KEYS = ['qualityProfileId', 'metadataProfileId', 'rootFolderId'] as const

// A server-connection target stores only the flag; the server drops any stale
// url/key. A separate instance sends its own fields plus its default IDs, with
// null clearing an ID back to "first available". After a url/key change the
// picked IDs belong to the old instance, so none are sent (the server clears them).
function buildLidarrConfig(
  targetType: AddTargetType,
  config: Record<string, string>,
  useServerConnection: boolean,
  isEditing: boolean,
  instanceChanged: boolean,
): Record<string, unknown> {
  const tags = instanceChanged ? [] : (config.tags ?? '').split(',').filter(Boolean).map(Number)
  if (useServerConnection) return { useServerConnection: true, tags }
  const base = isEditing
    ? (buildTargetConfigPatch(targetType, config) ?? {})
    : normalizeTargetConfig(targetType.value, config)
  const defaults: Record<string, number | null> = {}
  for (const key of instanceChanged ? [] : LIDARR_DEFAULT_KEYS) {
    if (config[key]) defaults[key] = Number(config[key])
    else if (isEditing) defaults[key] = null
  }
  return { ...base, ...defaults, tags, useServerConnection: false }
}

function LidarrInstanceDefaults({
  targetId,
  config,
  onChange,
}: {
  targetId: number
  config: Record<string, string>
  onChange: (key: (typeof LIDARR_DEFAULT_KEYS)[number], value: string) => void
}) {
  const { t } = useI18n()
  const { data, isError } = useQuery({
    queryKey: ['lidarrApproveOptions', targetId],
    queryFn: () => getLidarrApproveOptions(targetId),
  })
  if (isError) return <p className="text-xs text-reject">{t('approveDialog.loadFailed')}</p>
  const fields = [
    {
      key: 'qualityProfileId' as const,
      label: t('settings.qualityProfile'),
      options: data?.qualityProfiles.map((p) => ({ id: p.id, label: p.name })),
    },
    {
      key: 'metadataProfileId' as const,
      label: t('settings.metadataProfile'),
      options: data?.metadataProfiles.map((p) => ({ id: p.id, label: p.name })),
    },
    {
      key: 'rootFolderId' as const,
      label: t('settings.rootFolder'),
      options: data?.rootFolders.map((f) => ({ id: f.id, label: f.path })),
    },
  ]
  return (
    <div className="rounded-md border border-border bg-bg/60 p-3 space-y-2">
      <p className="text-xs font-medium text-text">{t('settings.targetLidarrInstanceDefaults')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {fields.map((field) => {
          const fieldId = `lidarr-target-${targetId}-${field.key}`
          return (
            <label key={field.key} htmlFor={fieldId} className="block text-xs text-muted">
              {field.label}
              <select
                id={fieldId}
                value={config[field.key] ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                disabled={!field.options}
                className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
              >
                <option value="">
                  {field.options ? t('settings.targetLidarrDefaultsUnset') : t('common.loading')}
                </option>
                {field.options?.map((option) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function LidarrTargetTags({
  targetId,
  value,
  onChange,
}: {
  targetId: number
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const { data, isError } = useQuery({
    queryKey: ['lidarrApproveOptions', targetId],
    queryFn: () => getLidarrApproveOptions(targetId),
  })
  if (isError) return <p className="text-xs text-reject">{t('approveDialog.loadFailed')}</p>
  if (!data) return <p className="text-xs text-muted">{t('common.loading')}</p>
  return (
    <LidarrTags
      targetId={targetId}
      available={data.tags ?? []}
      value={value.split(',').filter(Boolean).map(Number)}
      onChange={(tags) => onChange(tags.join(','))}
    />
  )
}

function serializeTargetConfigForForm(config: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value !== '***')
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value)]),
  )
}

function AddTargetDialog({
  onClose,
  onSaved,
  targets,
  initialTarget,
  users,
  currentUserId,
}: {
  onClose: () => void
  onSaved: () => void
  targets: Array<{
    id: number
    type: string
    name: string
    enabled: boolean
    userId: number | null
  }>
  users: Array<{ id: number; username: string }>
  currentUserId?: number
  initialTarget?: {
    id: number
    userId: number | null
    type: string
    name: string
    enabled: boolean
    config: Record<string, unknown>
  }
}) {
  const { t } = useI18n()
  const [userId, setUserId] = useState(initialTarget?.userId ?? currentUserId)
  const targetTypes = getTargetTypes(
    t,
    targets
      .filter((target) => target.type === 'lidarr' && target.enabled && target.userId === userId)
      .map((target) => ({ id: target.id, name: target.name })),
  )
  const [type, setType] = useState(initialTarget?.type ?? '')
  const [name, setName] = useState(initialTarget?.name ?? '')
  const [enabled, setEnabled] = useState(initialTarget?.enabled ?? true)
  const [config, setConfig] = useState<Record<string, string>>(
    initialTarget ? serializeTargetConfigForForm(initialTarget.config) : {},
  )
  const [saving, setSaving] = useState(false)
  const initialUsesServer = initialTarget ? initialTarget.config.useServerConnection === true : true
  const [useServerConnection, setUseServerConnection] = useState(initialUsesServer)

  const selectedType = targetTypes.find((tt) => tt.value === type)
  const isEditing = Boolean(initialTarget)
  const isLidarr = type === 'lidarr'
  const requiresLidarrDownloadPath = type === 'slskd' && Number(config.lidarrTargetId) > 0
  const missingLidarrDownloadPath = requiresLidarrDownloadPath && !config.lidarrDownloadPath?.trim()
  const hideConnectionFields = isLidarr && useServerConnection
  // The saved key is masked out of the form, so any typed key is a change.
  const instanceChanged =
    isEditing &&
    ((config.url ?? '').trim() !== String(initialTarget?.config.url ?? '').trim() ||
      Boolean(config.apiKey))

  async function handleSave() {
    if (!type || !selectedType || missingLidarrDownloadPath) return
    setSaving(true)
    try {
      if (initialTarget) {
        const configPatch = isLidarr
          ? buildLidarrConfig(selectedType, config, useServerConnection, true, instanceChanged)
          : buildTargetConfigPatch(selectedType, config)
        await updateTargetApi(initialTarget.id, {
          name: name || selectedType.label,
          enabled,
          userId,
          ...(configPatch ? { config: configPatch } : {}),
        })
        toast.success(t('settings.targetUpdated'))
      } else {
        await createTargetApi({
          type,
          userId,
          name: name || selectedType.label,
          config: isLidarr
            ? buildLidarrConfig(selectedType, config, useServerConnection, false, false)
            : normalizeTargetConfig(type, config),
        })
        toast.success(t('settings.targetAdded'))
      }
      onSaved()
      onClose()
    } catch {
      toast.error(isEditing ? t('settings.targetUpdateFailed') : t('settings.targetAddFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <h4 className="text-sm font-medium text-text">
        {isEditing ? t('settings.editTarget') : t('settings.addTarget')}
      </h4>

      {!isEditing && (
        <div>
          <label className="block text-xs text-muted mb-1">
            {t('settings.type')}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setConfig({})
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
            >
              <option value="">{t('settings.selectTargetType')}</option>
              {targetTypes
                .filter((tt) => tt.creatable !== false)
                .map((tt) => (
                  <option key={tt.value} value={tt.value}>
                    {tt.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {selectedType && (
        <>
          <label className="block text-xs text-muted">
            {t('settings.targetUser')}
            <select
              value={userId ?? ''}
              onChange={(e) => {
                setUserId(Number(e.target.value))
                setConfig((previous) => ({ ...previous, lidarrTargetId: '' }))
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
            >
              <option value="" disabled>
                {t('settings.targetUser')}
              </option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>
          <div>
            <label className="block text-xs text-muted mb-1">
              {t('settings.name')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedType.label}
                className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
              />
            </label>
          </div>

          {isEditing && (
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t('common.enabled')}
            </label>
          )}

          {isLidarr && (
            <div className="space-y-2">
              {useServerConnection && (
                <p className="text-xs text-muted">
                  {t('settings.targetLidarrServerConnectionHelp')}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={!useServerConnection}
                  onChange={(e) => {
                    setUseServerConnection(!e.target.checked)
                    setConfig((previous) => ({ ...previous, tags: '' }))
                  }}
                />
                {t('settings.targetLidarrUseOtherInstance')}
              </label>
            </div>
          )}

          {(hideConnectionFields ? [] : selectedType.fields).map((field) => (
            <div key={field.key}>
              {(() => {
                const fieldId = `add-target-${type}-${field.key}`
                return (
                  <label htmlFor={fieldId} className="block text-xs text-muted mb-1">
                    {field.label}
                    {field.key === 'lidarrDownloadPath' && requiresLidarrDownloadPath && (
                      <span className="ml-1">
                        - {t('settings.slskdLidarrDownloadPathRequired')}
                      </span>
                    )}
                    {field.kind === 'select' ? (
                      <select
                        id={fieldId}
                        value={config[field.key] ?? ''}
                        onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
                      >
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId}
                        type={field.type ?? 'text'}
                        min={field.min}
                        max={field.max}
                        required={field.key === 'lidarrDownloadPath' && requiresLidarrDownloadPath}
                        value={config[field.key] ?? ''}
                        onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
                      />
                    )}
                  </label>
                )
              })()}
            </div>
          ))}

          {isLidarr &&
            !useServerConnection &&
            (initialTarget && !initialUsesServer && instanceChanged ? (
              <p className="text-xs text-muted">
                {t('settings.targetLidarrDefaultsInstanceChanged')}
              </p>
            ) : initialTarget && !initialUsesServer ? (
              <LidarrInstanceDefaults
                targetId={initialTarget.id}
                config={config}
                onChange={(key, value) => setConfig((previous) => ({ ...previous, [key]: value }))}
              />
            ) : (
              <p className="text-xs text-muted">{t('settings.targetLidarrDefaultsSaveFirst')}</p>
            ))}

          {isLidarr &&
            (initialTarget && useServerConnection === initialUsesServer && !instanceChanged ? (
              <LidarrTargetTags
                targetId={initialTarget.id}
                value={config.tags ?? ''}
                onChange={(tags) => setConfig((previous) => ({ ...previous, tags }))}
              />
            ) : (
              <p className="text-xs text-muted">{t('settings.targetLidarrDefaultsSaveFirst')}</p>
            ))}

          {selectedType.value === 'slskd' && (
            <div className="rounded-md border border-border bg-bg/60 p-3 space-y-2">
              <p className="text-xs text-muted">{t('settings.slskdModeHelp')}</p>
              <p className="text-xs text-muted">{t('settings.slskdLidarrDownloadPathHint')}</p>
              <ul className="space-y-1 text-xs text-muted list-disc pl-4">
                <li>{t('settings.slskdReleasePolicy')}</li>
                <li>{t('settings.slskdQualityPolicy')}</li>
              </ul>
              <p className="text-xs text-muted">
                {config.lidarrTargetId
                  ? t('settings.approvalActionLidarrSlskd')
                  : t('settings.approvalActionSlskd')}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={
                saving ||
                !type ||
                !userId ||
                missingLidarrDownloadPath ||
                !users.some((user) => user.id === userId)
              }
            >
              {saving
                ? isEditing
                  ? t('settings.saving')
                  : t('settings.adding')
                : isEditing
                  ? t('settings.saveChanges')
                  : t('settings.addTarget')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function TargetsTab() {
  const { t } = useI18n()
  const { data: targets, refetch } = useQuery({
    queryKey: ['targets'],
    queryFn: listTargets,
  })
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const isAdmin = currentUser?.isAdmin ?? false
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: isAdmin })
  const [testing, setTesting] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<
    Record<number, { success: boolean; message: string }>
  >({})

  async function handleTest(id: number) {
    setTesting(id)
    try {
      const result = await testTargetApi(id)
      const key = result.details?.messageKey
      const message =
        key === 'settings.slskdPathIncomplete' ||
        key === 'settings.slskdPathUnavailable' ||
        key === 'settings.slskdPathOk'
          ? t(key)
          : result.message
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: result.success, message },
      }))
      if (result.success) {
        toast.success(t('settings.targetTestSuccess'))
      } else {
        toast.error(message || t('settings.targetTestFailed'))
      }
    } catch {
      toast.error(t('settings.targetTestFailed'))
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTargetApi(id)
      toast.success(t('settings.targetRemoved'))
      refetch()
    } catch {
      toast.error(t('settings.targetRemoveFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <Hint id="settings-targets-tip" type="inline">
        {t('settings.targetsTip')}
      </Hint>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">{t('settings.tabs.targets')}</h3>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? t('common.cancel') : t('settings.addTarget')}
          </Button>
        )}
      </div>

      {isAdmin && usersQuery.isError && (
        <p className="text-sm text-reject">{t('userManagement.failedToLoad')}</p>
      )}
      {addOpen && (
        <AddTargetDialog
          onClose={() => setAddOpen(false)}
          onSaved={() => refetch()}
          targets={targets ?? []}
          users={usersQuery.data ?? []}
          currentUserId={currentUser?.id}
        />
      )}

      {!addOpen && targets?.length === 0 && (
        <p className="text-sm text-muted">{t('settings.noTargets')}</p>
      )}

      {targets?.map((target) => {
        const owned = target.owned
        const testResult = testResults[target.id]
        const linkedLidarrTarget =
          typeof target.config.lidarrTargetId === 'number'
            ? targets?.find((item) => item.id === target.config.lidarrTargetId)
            : null
        return (
          <div key={target.id} className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <TargetTypeIcon type={target.type} />
                  <span className="text-sm font-medium text-text">{target.name}</span>
                  {target.type === 'lidarr' && target.config.useServerConnection === true ? (
                    <span className="text-xs text-muted">
                      ({t('settings.targetLidarrServerConnection')})
                    </span>
                  ) : (
                    <span className="text-xs text-muted capitalize">({target.type})</span>
                  )}
                  <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted border border-border">
                    {target.enabled ? t('common.enabled') : t('common.disabled')}
                  </span>
                  {testResult && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        testResult.success
                          ? 'bg-approve/15 text-approve'
                          : 'bg-reject/5 text-reject'
                      }`}
                    >
                      {testResult.success
                        ? t('settings.connected')
                        : t('settings.targetTestFailed')}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-muted border border-border">
                    {t('settings.targetUser')}:{' '}
                    {usersQuery.data?.find((user) => user.id === target.userId)?.username ??
                      target.userId ??
                      t('common.notAvailable')}
                  </span>
                )}
              </div>
              {(isAdmin || owned) && (
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingTargetId(target.id)}
                    >
                      {t('common.edit')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(target.id)}
                    disabled={testing === target.id}
                  >
                    {testing === target.id ? t('settings.testing') : t('settings.test')}
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(target.id)}
                      className="text-reject"
                    >
                      {t('settings.remove')}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {typeof target.config.url === 'string' && (
              <p className="text-xs text-muted">{target.config.url}</p>
            )}
            {linkedLidarrTarget && (
              <p className="text-xs text-muted">
                {t('settings.linkedTarget')} {linkedLidarrTarget.name}
              </p>
            )}
            {testResult?.message && <p className="text-xs text-muted">{testResult.message}</p>}
            {editingTargetId === target.id && (
              <AddTargetDialog
                onClose={() => setEditingTargetId(null)}
                onSaved={() => {
                  setEditingTargetId(null)
                  refetch()
                }}
                targets={targets ?? []}
                users={usersQuery.data ?? []}
                currentUserId={currentUser?.id}
                initialTarget={target}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Field } from '../../components/field'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Select } from '../../components/ui/select'
import {
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrRootFolders,
  getUserPreferences,
  updateUserPreferences,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'

export function LidarrPreferencesSection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: userPrefs } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
  })
  const { data: qualityProfiles } = useQuery({
    queryKey: ['lidarrProfiles'],
    queryFn: getLidarrProfiles,
  })
  const { data: metadataProfiles } = useQuery({
    queryKey: ['lidarrMetadataProfiles'],
    queryFn: getLidarrMetadataProfiles,
  })
  const { data: rootFolders } = useQuery({
    queryKey: ['lidarrRootFolders'],
    queryFn: getLidarrRootFolders,
  })

  const [qualityProfileId, setQualityProfileId] = useState('1')
  const [metadataProfileId, setMetadataProfileId] = useState('1')
  const [rootFolderId, setRootFolderId] = useState('')
  const [saving, setSaving] = useState(false)

  // Sync local state from user prefs when they load
  useEffect(() => {
    if (!userPrefs) return
    const p = userPrefs as Record<string, unknown>
    setQualityProfileId(String(p.qualityProfileId ?? 1))
    setMetadataProfileId(String(p.metadataProfileId ?? 1))
    setRootFolderId(p.rootFolderId != null ? String(p.rootFolderId) : '')
  }, [userPrefs])

  // Snap selectors to the first real Lidarr option when none is set or the
  // stored id no longer exists among the loaded options. Otherwise the browser
  // can visibly select the first option while React state still holds stale id 1.
  useEffect(() => {
    if (!qualityProfiles || qualityProfiles.length === 0) return
    const first = qualityProfiles[0]
    if (first && !qualityProfiles.some((p) => String(p.id) === qualityProfileId)) {
      setQualityProfileId(String(first.id))
    }
  }, [qualityProfiles, qualityProfileId])

  useEffect(() => {
    if (!metadataProfiles || metadataProfiles.length === 0) return
    const first = metadataProfiles[0]
    if (first && !metadataProfiles.some((p) => String(p.id) === metadataProfileId)) {
      setMetadataProfileId(String(first.id))
    }
  }, [metadataProfiles, metadataProfileId])

  // Snap root folder selector to the first real folder when none is set
  // or the stored id no longer exists among the loaded folders.
  useEffect(() => {
    if (!rootFolders || rootFolders.length === 0) return
    const first = rootFolders[0]
    if (first && !rootFolders.some((f) => String(f.id) === rootFolderId)) {
      setRootFolderId(String(first.id))
    }
  }, [rootFolders, rootFolderId])

  async function handleSave() {
    setSaving(true)
    try {
      await updateUserPreferences({
        qualityProfileId: parseInt(qualityProfileId, 10) || 1,
        metadataProfileId: parseInt(metadataProfileId, 10) || 1,
        rootFolderId: rootFolderId ? parseInt(rootFolderId, 10) : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      toast.success(t('settings.lidarrPreferencesSaved'))
    } catch {
      toast.error(t('settings.lidarrPreferencesFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Disclosure title={t('settings.lidarrPreferences')} className="bg-surface">
      <div className="space-y-4">
        <p className="text-small text-muted">{t('settings.lidarrPreferencesDescription')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('settings.qualityProfile')} id="user-quality-profile">
            <Select
              id="user-quality-profile"
              value={qualityProfileId}
              onChange={(e) => setQualityProfileId(e.target.value)}
            >
              {qualityProfiles ? (
                qualityProfiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option value={qualityProfileId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
          <Field label={t('settings.metadataProfile')} id="user-metadata-profile">
            <Select
              id="user-metadata-profile"
              value={metadataProfileId}
              onChange={(e) => setMetadataProfileId(e.target.value)}
            >
              {metadataProfiles ? (
                metadataProfiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option value={metadataProfileId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
          <Field label={t('settings.rootFolder')} id="user-root-folder">
            <Select
              id="user-root-folder"
              value={rootFolderId}
              onChange={(e) => setRootFolderId(e.target.value)}
            >
              {rootFolders ? (
                rootFolders.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {f.path}
                  </option>
                ))
              ) : (
                <option value={rootFolderId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </div>
      </div>
    </Disclosure>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { setAudiodbProxyFlag } from '../../components/artist-thumb'
import { Field } from '../../components/field'
import { ServiceCard } from '../../components/service-card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { getUserPreferences, updateSettings, updateUserPreferences } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import type { Settings } from './types'

export function ArtistImagesCard({
  settings,
  isAdmin,
  onSaved,
}: {
  settings: Settings
  isAdmin: boolean
  onSaved: () => void
}) {
  const { data: prefs } = useQuery({ queryKey: ['user-preferences'], queryFn: getUserPreferences })
  const { t } = useI18n()
  useEffect(() => {
    if (typeof settings.audiodbProxyImages === 'boolean')
      setAudiodbProxyFlag(settings.audiodbProxyImages)
  }, [settings.audiodbProxyImages])
  if (!prefs) return <p className="text-sm text-muted">{t('settings.loadingPreferences')}</p>
  return <ArtistImagesForm settings={settings} prefs={prefs} isAdmin={isAdmin} onSaved={onSaved} />
}

function ArtistImagesForm({
  settings,
  prefs,
  isAdmin,
  onSaved,
}: {
  settings: Settings
  prefs: Record<string, unknown>
  isAdmin: boolean
  onSaved: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [fanartApiKey, setFanartApiKey] = useState(String(prefs.fanartApiKey ?? ''))
  const [metadataFallbackUrl, setMetadataFallbackUrl] = useState(
    String(prefs.metadataFallbackUrl ?? ''),
  )
  const [audiodbApiKey, setAudiodbApiKey] = useState(
    settings.audiodbApiKey === '***' ? '' : (settings.audiodbApiKey ?? ''),
  )
  const [audiodbProxyImages, setAudiodbProxyImages] = useState(Boolean(settings.audiodbProxyImages))
  const [wikidataEnabled, setWikidataEnabled] = useState(settings.wikidataEnabled !== false)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    let personalSaved = false
    try {
      await updateUserPreferences({
        fanartApiKey: fanartApiKey === '***' ? undefined : fanartApiKey || undefined,
        metadataFallbackUrl: metadataFallbackUrl || undefined,
      })
      personalSaved = true
      void queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      await updateSettings({
        audiodbApiKey: audiodbApiKey || (settings.audiodbApiKey === '***' ? undefined : null),
        audiodbProxyImages,
        wikidataEnabled,
      })
      setAudiodbProxyFlag(audiodbProxyImages)
      onSaved()
      toast.success(
        t('settings.serviceSettingsSavedToast').replace('{0}', t('settings.imageSources')),
      )
    } catch {
      toast.error(
        personalSaved
          ? t('settings.artistImagesPartiallySaved')
          : t('settings.serviceSettingsFailedToast').replace('{0}', t('settings.imageSources')),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <ServiceCard
      name={t('settings.imageSources')}
      icon={<ImageIcon aria-hidden="true" className="h-6 w-6 text-muted" />}
      status="saved"
      description={isAdmin ? t('settings.imageSourcesHelp') : t('settings.adminOnly')}
    >
      {isAdmin && (
        <>
          <Field label={t('settings.audiodb.apiKey')} id="audiodb-api-key">
            <Input
              id="audiodb-api-key"
              type="password"
              value={audiodbApiKey}
              onChange={(e) => setAudiodbApiKey(e.target.value)}
              placeholder={
                settings.audiodbApiKey === '***'
                  ? `(${t('settings.saved')})`
                  : t('settings.audiodb.apiKeyPlaceholder')
              }
            />
          </Field>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={audiodbProxyImages}
              onChange={(e) => setAudiodbProxyImages(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-text">
              {t('settings.audiodb.proxyImages')}
              <span className="block text-micro text-muted">{t('settings.audiodb.proxyHint')}</span>
            </span>
          </label>
          <Field label={t('settings.fieldFanartApiKey')} id="fanart-api-key">
            <Input
              id="fanart-api-key"
              type="password"
              value={fanartApiKey}
              onChange={(e) => setFanartApiKey(e.target.value)}
              placeholder={t('settings.fieldFanartApiKey')}
            />
          </Field>
          <Field label={t('settings.fieldMetadataFallbackUrl')} id="metadata-fallback-url">
            <Input
              id="metadata-fallback-url"
              value={metadataFallbackUrl}
              onChange={(e) => setMetadataFallbackUrl(e.target.value)}
              placeholder="https://api.musicinfo.pro"
            />
          </Field>
          <p className="text-micro text-muted">{t('settings.metadataFallbackHelp')}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={wikidataEnabled}
              onChange={(e) => setWikidataEnabled(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-text">{t('settings.wikidata.enabled')}</span>
          </label>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </>
      )}
    </ServiceCard>
  )
}

import type { ReactNode } from 'react'
import { Field } from '../../components/field'
import { ServiceCard, type ServiceStatus } from '../../components/service-card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../lib/i18n'
import { savedSecretPlaceholder } from './shared'

export function ServiceFormFooter({
  onTest,
  testing,
  onSave,
  saving,
  configured = true,
  showTest = true,
}: {
  onTest: () => void
  testing: boolean
  onSave: () => void
  saving?: boolean
  configured?: boolean
  showTest?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex justify-end gap-2 pt-1">
      {showTest && (
        <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
          {testing ? t('settings.testing') : t('settings.testConnection')}
        </Button>
      )}
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? t('settings.saving') : configured ? t('settings.save') : t('settings.configure')}
      </Button>
    </div>
  )
}

type Library = { id: string; name: string }

export function MediaServerCard({
  id,
  name,
  icon,
  description,
  defaultOpen,
  status,
  onEdit,
  onRemove,
  removing,
  userIdLabel,
  userIdHelp,
  savedApiKey,
  url,
  onUrlChange,
  apiKey,
  onApiKeyChange,
  userId,
  onUserIdChange,
  libraryId,
  onLibraryIdChange,
  libraries,
  footer,
}: {
  id: string
  name: string
  icon: ReactNode
  description: string
  defaultOpen: boolean
  status: ServiceStatus
  onEdit: () => void
  onRemove?: () => void
  removing?: boolean
  userIdLabel: string
  userIdHelp: string
  savedApiKey: string | null | undefined
  url: string
  onUrlChange: (value: string) => void
  apiKey: string
  onApiKeyChange: (value: string) => void
  userId: string
  onUserIdChange: (value: string) => void
  libraryId: string
  onLibraryIdChange: (value: string) => void
  libraries: Library[]
  footer: ReactNode
}) {
  const { t } = useI18n()
  return (
    <ServiceCard
      defaultOpen={defaultOpen}
      onRemove={onRemove}
      removing={removing}
      name={name}
      description={description}
      status={status}
      onEdit={onEdit}
      icon={icon}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('settings.fieldServerUrl')} id={`${id}-url`}>
          <Input
            id={`${id}-url`}
            type="url"
            placeholder="http://localhost:8096"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
          />
        </Field>
        <Field label={t('settings.fieldApiKey')} id={`${id}-apikey`}>
          <Input
            id={`${id}-apikey`}
            type="password"
            placeholder={savedSecretPlaceholder(
              savedApiKey,
              t('settings.fieldApiKey'),
              t('settings.saved'),
            )}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
          />
        </Field>
      </div>
      <Field label={userIdLabel} id={`${id}-userid`}>
        <Input
          id={`${id}-userid`}
          placeholder={userIdLabel}
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
        />
        <p className="text-xs text-muted mt-1">{userIdHelp}</p>
      </Field>
      <Field label={t('settings.musicLibrary')} id={`${id}-library`}>
        <Select
          id={`${id}-library`}
          value={libraryId}
          onChange={(e) => onLibraryIdChange(e.target.value)}
        >
          <option value="">{t('settings.musicLibraryAll')}</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {libraryId && !libraries.some((l) => l.id === libraryId) && (
            <option value={libraryId}>
              {t('settings.musicLibraryId').replace('{0}', libraryId)}
            </option>
          )}
        </Select>
        <p className="text-xs text-muted mt-1">{t('settings.musicLibraryHint')}</p>
      </Field>
      {footer}
    </ServiceCard>
  )
}

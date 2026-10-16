import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field } from '../../components/field'
import { Hint } from '../../components/hint'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Input } from '../../components/ui/input'
import { getAuthMeta, testService, updateSettings } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import type { Settings } from './types'

export function AuthTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState(settings.oidcIssuerUrl ?? '')
  const [oidcClientId, setOidcClientId] = useState(settings.oidcClientId ?? '')
  const [oidcClientSecret, setOidcClientSecret] = useState(
    settings.oidcClientSecret === '***' ? '' : (settings.oidcClientSecret ?? ''),
  )
  const [secretDirty, setSecretDirty] = useState(false)
  const [oidcScopes, setOidcScopes] = useState(settings.oidcScopes ?? '')
  const [saving, setSaving] = useState(false)
  const [testingOidc, setTestingOidc] = useState(false)

  // proxyAuthEnabled moved off /auth/status (fingerprint hardening); fetch
  // it from /auth/meta (auth-gated). Settings page is always authenticated.
  const { data: authMeta } = useQuery({
    queryKey: ['authMeta'],
    queryFn: getAuthMeta,
  })

  async function handleSave() {
    setSaving(true)
    try {
      const updates: Record<string, unknown> = {
        oidcIssuerUrl: oidcIssuerUrl || undefined,
        oidcClientId: oidcClientId || undefined,
        oidcScopes: oidcScopes || undefined,
      }
      if (secretDirty) {
        updates.oidcClientSecret = oidcClientSecret || undefined
      }
      await updateSettings(updates)
      await queryClient.invalidateQueries({ queryKey: ['authMeta'] })
      toast.success(t('settings.authSaved'))
      onSaved()
    } catch {
      toast.error(t('settings.authFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTestOidc() {
    setTestingOidc(true)
    try {
      await testService('oidc', {
        issuerUrl: oidcIssuerUrl,
        clientId: oidcClientId,
        clientSecret: oidcClientSecret || undefined,
      })
      toast.success(t('settings.oidcTestSuccess'))
    } catch {
      toast.error(t('settings.oidcTestFailed'))
    } finally {
      setTestingOidc(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-auth-tip" type="inline">
        {t('settings.authTip')}
      </Hint>

      <section className="space-y-4">
        <div>
          <h2 className="text-lead font-semibold text-text">{t('settings.oidcSso')}</h2>
          <p className="text-xs text-muted mt-1">{t('settings.oidcDescription')}</p>
        </div>
        <Field label={t('settings.fieldIssuerUrl')} id="oidc-issuer-url">
          <Input
            id="oidc-issuer-url"
            type="url"
            placeholder="https://auth.example.com"
            value={oidcIssuerUrl}
            onChange={(e) => setOidcIssuerUrl(e.target.value)}
          />
        </Field>
        <Field label={t('settings.fieldClientId')} id="oidc-client-id">
          <Input
            id="oidc-client-id"
            placeholder={t('settings.fieldClientId')}
            value={oidcClientId}
            onChange={(e) => setOidcClientId(e.target.value)}
          />
        </Field>
        <Field label={t('settings.fieldClientSecret')} id="oidc-client-secret">
          <Input
            id="oidc-client-secret"
            type="password"
            placeholder={
              settings.oidcClientSecret === '***'
                ? `(${t('settings.saved')})`
                : t('settings.fieldClientSecret')
            }
            value={oidcClientSecret}
            onChange={(e) => {
              setOidcClientSecret(e.target.value)
              setSecretDirty(true)
            }}
          />
        </Field>
        <Disclosure title={t('settings.advancedSettings')} defaultOpen={!!settings.oidcScopes}>
          <Field label={t('settings.fieldScopes')} id="oidc-scopes">
            <Input
              id="oidc-scopes"
              placeholder="openid profile email"
              value={oidcScopes}
              onChange={(e) => setOidcScopes(e.target.value)}
            />
          </Field>
        </Disclosure>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestOidc}
            disabled={testingOidc || !oidcIssuerUrl || !oidcClientId}
          >
            {testingOidc ? t('settings.testing') : t('settings.testConnection')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </div>
      </section>

      {/* Remount once auth meta loads so an enabled proxy opens instead of hiding */}
      <Disclosure
        key={String(!!authMeta?.proxyAuthEnabled)}
        title={t('settings.reverseProxyAuth')}
        defaultOpen={!!authMeta?.proxyAuthEnabled}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {t('settings.reverseProxyDescription')} {t('settings.reverseProxyConfigHint')}
          </p>
          <p className="text-sm">
            {authMeta?.proxyAuthEnabled ? (
              <span className="text-text">{t('settings.proxyEnabled')}</span>
            ) : (
              <span className="text-muted">{t('settings.proxyDisabled')}</span>
            )}
          </p>
        </div>
      </Disclosure>
    </div>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { SupportedLocale } from '@/core/i18n/locales'
import { errMsg } from '@/core/validation'
import { ApiTokensSection } from '../../components/api-tokens-section'
import { Field } from '../../components/field'
import { LanguageSelect } from '../../components/language-switcher'
import { ScrobblerWriteBackSettings } from '../../components/scrobbler-write-back-settings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useHints } from '../../hooks/use-hints'
import { useInstallPrompt } from '../../hooks/use-install-prompt'
import {
  AUTH_EXPIRED_EVENT,
  changePassword,
  clearStoredToken,
  getAuthMeta,
  getCurrentUser,
  linkOidcAccount,
  logoutUser,
  updateEmail,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { broadcastSessionChanged } from '../../lib/session-broadcast'

export function AccountTab() {
  const { t, locale, setLocale } = useI18n()
  const queryClient = useQueryClient()
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const { data: authMeta } = useQuery({ queryKey: ['authMeta'], queryFn: getAuthMeta })
  const [searchParams, setSearchParams] = useSearchParams()
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const [linkPassword, setLinkPassword] = useState('')
  const [linking, setLinking] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [email, setEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const { canInstall, showIosHint, promptInstall, dismiss } = useInstallPrompt()
  const { resetHints, dismissedCount } = useHints()

  useEffect(() => {
    setEmail(user?.email ?? '')
  }, [user?.email])

  useEffect(() => {
    const result = searchParams.get('oidc_link')
    if (!result) return
    setLinkNotice(result)
    const next = new URLSearchParams(searchParams)
    next.delete('oidc_link')
    setSearchParams(next, { replace: true })
    void queryClient.invalidateQueries({ queryKey: ['currentUser'] })
  }, [searchParams, setSearchParams, queryClient])

  async function handleLinkOidc(e: React.FormEvent) {
    e.preventDefault()
    setLinking(true)
    setLinkNotice(null)
    try {
      const { url } = await linkOidcAccount(linkPassword)
      setLinkPassword('')
      window.location.assign(url)
    } catch (err: unknown) {
      toast.error(errMsg(err))
      setLinking(false)
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    const next = email.trim()
    if (next === (user?.email ?? '')) return
    setSavingEmail(true)
    try {
      await updateEmail(next || null)
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] })
      toast.success(t('settings.emailSaved'))
    } catch (err: unknown) {
      const msg = errMsg(err)
      toast.error(msg.includes('409') ? t('settings.emailTaken') : msg)
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleLogout() {
    try {
      await logoutUser()
    } catch {
      // Session might already be invalid
    }
    clearStoredToken()
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    broadcastSessionChanged()
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.passwordsDoNotMatch'))
      return
    }
    if (newPassword.length < 12) {
      toast.error(t('settings.passwordTooShort'))
      return
    }
    setSaving(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success(t('settings.passwordChanged'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const msg = errMsg(err)
      toast.error(
        msg.includes('401') || msg.includes('403') ? t('settings.currentPasswordIncorrect') : msg,
      )
    } finally {
      setSaving(false)
    }
  }

  function handleLocaleChange(nextLocale: SupportedLocale) {
    setLocale(nextLocale)
  }

  return (
    <div className="space-y-6 max-w-lg">
      {linkNotice && (
        <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p>
            {linkNotice === 'success'
              ? t('settings.oidcLinkSuccess')
              : linkNotice === 'identity_in_use'
                ? t('settings.oidcLinkIdentityInUse')
                : t('settings.oidcLinkFailed')}
          </p>
          <Button variant="outline" size="sm" onClick={() => setLinkNotice(null)}>
            {t('discoveryMode.dismiss')}
          </Button>
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-lead font-semibold text-text">{t('settings.profile')}</h2>
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">
            {t('settings.signedInAs')}{' '}
            <span className="text-text font-medium">{user?.username ?? '...'}</span>
            {user?.isAdmin && (
              <span className="ml-2 text-xs bg-accent text-accent-fg px-1.5 py-0.5 rounded">
                {t('userManagement.adminBadge')}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            {t('settings.logOut')}
          </Button>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-lead font-semibold text-text">{t('settings.security')}</h2>
        <section className="space-y-3">
          <h3 className="text-body font-semibold text-text">{t('settings.email')}</h3>
          <p className="text-xs text-muted">{t('settings.emailHelp')}</p>
          <form onSubmit={handleSaveEmail} className="space-y-3">
            <Field label={t('settings.emailAddress')} id="account-email">
              <Input
                id="account-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder={t('settings.emailPlaceholder')}
              />
            </Field>
            <Button type="submit" disabled={savingEmail || email.trim() === (user?.email ?? '')}>
              {savingEmail ? t('settings.saving') : t('settings.saveEmail')}
            </Button>
          </form>
        </section>

        {authMeta?.oidcEnabled && (user?.oidcSubject || user?.authProvider === 'local') && (
          <section className="space-y-3">
            <h3 className="text-body font-semibold text-text">{t('settings.oidcSso')}</h3>
            {user?.oidcSubject ? (
              <p className="text-sm text-muted">{t('settings.oidcLinked')}</p>
            ) : user?.authProvider === 'local' ? (
              <form onSubmit={handleLinkOidc} className="space-y-3">
                <p className="text-xs text-muted">{t('settings.oidcLinkHelp')}</p>
                <Field label={t('settings.currentPassword')} id="oidc-link-password">
                  <Input
                    id="oidc-link-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={linkPassword}
                    onChange={(e) => setLinkPassword(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={linking || !linkPassword}>
                  {linking ? t('settings.oidcLinking') : t('settings.oidcLinkAction')}
                </Button>
              </form>
            ) : null}
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-body font-semibold text-text">{t('settings.changePassword')}</h3>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <Field label={t('settings.currentPassword')} id="current-pw">
              <Input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label={t('settings.newPassword')} id="new-pw">
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t('settings.minCharsPassword')}
              />
            </Field>
            <Field label={t('settings.confirmNewPassword')} id="confirm-pw">
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" disabled={saving}>
              {saving ? t('settings.changing') : t('settings.changePassword')}
            </Button>
          </form>
        </section>
      </section>

      <ScrobblerWriteBackSettings />

      <section className="space-y-3">
        <h2 className="text-lead font-semibold text-text">{t('settings.language')}</h2>
        <Field label={t('common.language')} id="preferred-locale">
          <LanguageSelect id="preferred-locale" value={locale} onChange={handleLocaleChange} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-lead font-semibold text-text">{t('settings.tips')}</h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{t('settings.tipsDescription')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={dismissedCount === 0}
            onClick={() => {
              resetHints().then(
                () => toast.success(t('settings.tipsRestored')),
                (err) => toast.error(errMsg(err)),
              )
            }}
          >
            {t('settings.showTipsAgain')}
          </Button>
        </div>
      </section>

      <ApiTokensSection isAdmin={user?.isAdmin ?? false} />
      {(canInstall || showIosHint) && (
        <section className="space-y-3">
          <h2 className="text-lead font-semibold text-text">{t('settings.app')}</h2>
          <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-text">{t('settings.installDigarr')}</p>
              {showIosHint ? (
                <p className="text-xs text-muted mt-0.5">{t('settings.installIosHint')}</p>
              ) : (
                <p className="text-xs text-muted mt-0.5">{t('settings.installHint')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="text-xs text-muted hover:text-text transition-colors"
              >
                {t('discoveryMode.dismiss')}
              </button>
              {canInstall && (
                <button
                  type="button"
                  onClick={promptInstall}
                  className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-fg rounded hover:bg-accent/90 transition-colors"
                >
                  {t('settings.install')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

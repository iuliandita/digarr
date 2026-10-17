import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  User,
  Wrench,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { getLocaleLabel, normalizeLocale, type SupportedLocale } from '@/core/i18n/locales'
import { errMsg } from '@/core/validation'
import { CHANNEL, GIT_SHA, VERSION } from '@/version'
import { AuthGate } from './components/auth-gate'
import { BottomNav } from './components/bottom-nav'
import { ErrorBoundary } from './components/error-boundary'
import { KeyboardShortcuts } from './components/keyboard-shortcuts'
import { LanguageSwitcher } from './components/language-switcher'
import { PreviewPlayer } from './components/preview-player'
import { useAuditionQueue } from './hooks/use-audition-queue'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { useMenu } from './hooks/use-menu'
import { usePreview } from './hooks/use-preview'
import {
  AUTH_EXPIRED_EVENT,
  clearStoredToken,
  getCurrentUser,
  getPipelineStatus,
  getSetupStatus,
  logoutUser,
  triggerPipeline,
  updatePreferredLocale,
} from './lib/api'
import { useI18n } from './lib/i18n'
import { MENU_CLASS, MENU_ITEM_CLASS } from './lib/menu-styles'
import { isSettingsActive, type NavItem, PRIMARY_NAV, TOOLS_NAV } from './lib/nav'
import { PreviewContext } from './lib/preview-context'
import { queryClient } from './lib/query-client'
import { broadcastSessionChanged } from './lib/session-broadcast'
import {
  applyTheme,
  COLOR_THEMES,
  type ColorTheme,
  getStoredColorTheme,
  getStoredMode,
  type Mode,
  setStoredColorTheme,
  setStoredMode,
} from './lib/theme'
import { cn } from './lib/utils'
// Eager: dashboard is the default landing surface and setup gates the entire app
import { Dashboard } from './pages/dashboard'
import { SetupWizard } from './pages/setup'

// Lazy: secondary routes split into per-page bundles to shrink first paint
const AnalyticsPage = lazy(() =>
  import('./pages/analytics').then((m) => ({ default: m.AnalyticsPage })),
)
const DiscoverPage = lazy(() =>
  import('./pages/discover').then((m) => ({ default: m.DiscoverPage })),
)
const DiscoveryModesPage = lazy(() =>
  import('./pages/discovery-modes').then((m) => ({ default: m.DiscoveryModesPage })),
)
const GenreDetailPage = lazy(() =>
  import('./pages/genre-detail').then((m) => ({ default: m.GenreDetailPage })),
)
const GenresPage = lazy(() => import('./pages/genres').then((m) => ({ default: m.GenresPage })))
const LibraryPage = lazy(() => import('./pages/library').then((m) => ({ default: m.LibraryPage })))
const PlaylistDetailPage = lazy(() =>
  import('./pages/playlist-detail').then((m) => ({ default: m.PlaylistDetailPage })),
)
const PlaylistsPage = lazy(() =>
  import('./pages/playlists').then((m) => ({ default: m.PlaylistsPage })),
)
const SearchPage = lazy(() => import('./pages/search').then((m) => ({ default: m.SearchPage })))
const SettingsPage = lazy(() =>
  import('./pages/settings').then((m) => ({ default: m.SettingsPage })),
)
const SubscriptionsPage = lazy(() => import('./pages/subscriptions'))
const UserManagementPage = lazy(() =>
  import('./pages/user-management').then((m) => ({ default: m.UserManagementPage })),
)

// Service worker registration

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// Mobile nav toggle

function MobileMenuIcon({ open }: { open: boolean }) {
  const { t } = useI18n()
  return (
    <svg
      className="w-6 h-6 text-text"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      role="img"
      aria-label={open ? t('app.closeMenu') : t('app.openMenu')}
    >
      {open ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      )}
    </svg>
  )
}

// Nav

function useRouteKey() {
  const { pathname, search } = useLocation()
  return pathname + search
}

function navItemClass(active: boolean) {
  return cn(
    'inline-flex min-h-9 items-center gap-1.5 rounded-control px-2.5 text-body font-medium transition-colors focus-ring',
    active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
  )
}

function iconButtonClass(active = false) {
  return cn(
    'flex h-11 w-11 items-center justify-center rounded-control transition-colors focus-ring md:h-9 md:w-9',
    active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
  )
}

function PrimaryNavLink({ item }: { item: NavItem }) {
  const { t } = useI18n()
  const location = useLocation()
  const active = item.isActive(location)
  const label = t(item.labelKey)
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      className={navItemClass(active)}
    >
      <item.icon size={16} aria-hidden="true" className="xl:hidden" />
      <span className="hidden xl:inline">{label}</span>
    </Link>
  )
}

function ToolsMenu() {
  const { t } = useI18n()
  const location = useLocation()
  const menu = useMenu(useRouteKey())
  const active = TOOLS_NAV.some((item) => item.isActive(location))
  return (
    <div ref={menu.containerRef} className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        aria-label={t('nav.tools')}
        title={t('nav.tools')}
        className={navItemClass(active)}
      >
        <Wrench size={16} aria-hidden="true" className="xl:hidden" />
        <span className="hidden xl:inline">{t('nav.tools')}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn('transition-transform', menu.open && 'rotate-180')}
        />
      </button>
      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          aria-label={t('nav.tools')}
          className={cn(MENU_CLASS, 'left-0 w-56')}
        >
          {TOOLS_NAV.map((item) => {
            const itemActive = item.isActive(location)
            return (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                tabIndex={-1}
                aria-current={itemActive ? 'page' : undefined}
                className={cn(MENU_ITEM_CLASS, itemActive ? 'text-accent-text' : 'text-text')}
              >
                <item.icon size={16} aria-hidden="true" className="shrink-0 text-muted" />
                {t(item.labelKey)}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// App shell

function ThemePicker({
  mode,
  colorTheme,
  onModeChange,
  onColorThemeChange,
}: {
  mode: Mode
  colorTheme: ColorTheme
  onModeChange: (m: Mode) => void
  onColorThemeChange: (t: ColorTheme) => void
}) {
  const { t } = useI18n()
  const menu = useMenu(useRouteKey())
  const ModeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor

  return (
    <div className="relative" ref={menu.containerRef}>
      <button
        type="button"
        {...menu.triggerProps}
        className={iconButtonClass()}
        aria-label={t('app.themeSettings')}
        title={t('app.theme')}
      >
        <ModeIcon size={18} aria-hidden="true" />
      </button>
      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          aria-label={t('app.themeSettings')}
          className={cn(MENU_CLASS, 'right-0 w-56')}
        >
          <fieldset className="m-0 border-0 p-0">
            <legend className="px-3 py-1.5 text-caption text-muted">{t('app.themeMode')}</legend>
            {(['dark', 'light', 'system'] as const).map((m) => {
              const Icon = m === 'dark' ? Moon : m === 'light' ? Sun : Monitor
              const label =
                m === 'dark'
                  ? t('app.themeModeDark')
                  : m === 'light'
                    ? t('app.themeModeLight')
                    : t('app.themeModeSystem')
              return (
                <button
                  key={m}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === m}
                  tabIndex={-1}
                  onClick={() => onModeChange(m)}
                  className={cn(MENU_ITEM_CLASS, mode === m ? 'text-accent-text' : 'text-text')}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              )
            })}
          </fieldset>
          <hr className="my-1 border-border" />
          <div className="max-h-[320px] overflow-y-auto">
            {(['Editor', 'Streaming'] as const).map((group) => (
              <fieldset
                key={group}
                aria-label={
                  group === 'Editor' ? t('app.themeGroupEditor') : t('app.themeGroupStreaming')
                }
                className="m-0 border-0 p-0"
              >
                <div
                  aria-hidden="true"
                  className="sticky top-0 bg-surface px-3 py-1.5 text-caption text-muted"
                >
                  {group === 'Editor' ? t('app.themeGroupEditor') : t('app.themeGroupStreaming')}
                </div>
                {COLOR_THEMES.filter((theme) => theme.group === group).map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={colorTheme === theme.id}
                    tabIndex={-1}
                    onClick={() => onColorThemeChange(theme.id)}
                    className={cn(
                      MENU_ITEM_CLASS,
                      colorTheme === theme.id ? 'text-accent-text' : 'text-text',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        colorTheme === theme.id ? 'bg-accent' : 'bg-border',
                      )}
                    />
                    {theme.name}
                  </button>
                ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu({ username }: { username: string }) {
  const { t } = useI18n()
  const menu = useMenu(useRouteKey())

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

  return (
    <div ref={menu.containerRef} className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        className={iconButtonClass()}
        aria-label={username}
        title={username}
      >
        <User size={18} aria-hidden="true" />
      </button>
      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          aria-label={username}
          className={cn(MENU_CLASS, 'right-0 w-56')}
        >
          <p
            aria-hidden="true"
            className="truncate border-b border-border px-3 pb-2 pt-1 text-body font-medium text-text"
          >
            {username}
          </p>
          <Link
            to="/settings?tab=account"
            role="menuitem"
            tabIndex={-1}
            className={cn(MENU_ITEM_CLASS, 'text-text')}
          >
            <Settings size={14} aria-hidden="true" className="text-muted" />
            {t('app.userMenu.settings')}
          </Link>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={handleLogout}
            className={cn(MENU_ITEM_CLASS, 'text-text')}
          >
            <LogOut size={14} aria-hidden="true" className="text-muted" />
            {t('app.userMenu.logout')}
          </button>
        </div>
      )}
    </div>
  )
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { data: currentUser, isPending } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  })
  if (isPending) return null
  // A failed lookup must not bounce admins; the server still gates these pages.
  return currentUser && !currentUser.isAdmin ? <Navigate to="/" replace /> : children
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setModeState] = useState<Mode>(getStoredMode)
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(getStoredColorTheme)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const preview = usePreview()
  const audition = useAuditionQueue(preview)
  const latestRequestedLocaleRef = useRef<SupportedLocale | null>(null)
  const submittedPendingLocaleRef = useRef<SupportedLocale | null>(null)
  const queryClient = useQueryClient()
  const { locale, pendingLocale, setLocale, hydrateLocale, t } = useI18n()
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const { data: pipelineStatus } = useQuery({
    queryKey: ['pipelineStatus'],
    queryFn: getPipelineStatus,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 15000),
  })
  const pipelineRunning = pipelineStatus?.running ?? false
  const localeMutation = useMutation({
    mutationFn: updatePreferredLocale,
    onSuccess: ({ preferredLocale }) => {
      const normalizedPreferredLocale = normalizeLocale(preferredLocale)
      if (
        normalizedPreferredLocale &&
        latestRequestedLocaleRef.current &&
        normalizedPreferredLocale !== latestRequestedLocaleRef.current
      ) {
        return
      }
      queryClient.setQueryData(['currentUser'], (prev: typeof currentUser) =>
        prev ? { ...prev, preferredLocale } : prev,
      )
    },
  })

  useKeyboardShortcuts({ '?': () => setShortcutsOpen((v) => !v) })

  useEffect(() => {
    const preferredLocale = normalizeLocale(currentUser?.preferredLocale)
    if (preferredLocale) {
      hydrateLocale(preferredLocale)
    }
  }, [currentUser?.preferredLocale, hydrateLocale])

  useEffect(() => {
    if (!pendingLocale) {
      submittedPendingLocaleRef.current = null
      return
    }

    if (!currentUser) return

    const preferredLocale = normalizeLocale(currentUser.preferredLocale)
    if (preferredLocale === pendingLocale) {
      submittedPendingLocaleRef.current = null
      return
    }

    if (submittedPendingLocaleRef.current === pendingLocale) return

    submittedPendingLocaleRef.current = pendingLocale
    latestRequestedLocaleRef.current = pendingLocale
    localeMutation.mutate(pendingLocale)
  }, [currentUser, localeMutation, pendingLocale])

  function handleModeChange(m: Mode) {
    setModeState(m)
    setStoredMode(m)
    applyTheme(colorTheme, m)
  }

  function handleColorThemeChange(t: ColorTheme) {
    setColorThemeState(t)
    setStoredColorTheme(t)
    applyTheme(t, mode)
  }

  function handleLocaleChange(nextLocale: SupportedLocale) {
    latestRequestedLocaleRef.current = nextLocale
    setLocale(nextLocale)
    if (currentUser) {
      submittedPendingLocaleRef.current = nextLocale
      localeMutation.mutate(nextLocale)
    }
  }

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => applyTheme(colorTheme, 'system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode, colorTheme])

  const location = useLocation()
  const isAdmin = currentUser?.isAdmin ?? false
  const settingsActive = isSettingsActive(location)

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile menu on navigation
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  return (
    <PreviewContext.Provider
      value={{
        play: preview.play,
        stop: preview.stop,
        hasPreview: preview.hasPreview,
        currentMbid: preview.state.artistMbid,
        playing: preview.state.playing,
        globalPlayId: preview.globalPlayId,
        volume: preview.volume,
        setVolume: preview.setVolume,
        audition,
      }}
    >
      <div className="min-h-screen bg-bg">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
        >
          {t('app.skipToContent')}
        </a>
        <nav
          className="border-b border-border px-4 py-2 sm:px-6"
          aria-label={t('app.mainNavigation')}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4 lg:gap-6">
              <Link
                to="/"
                className="text-title font-bold text-accent-text focus-ring rounded-control"
              >
                digarr
              </Link>
              <ul className="hidden items-center gap-1 md:flex">
                {PRIMARY_NAV.map((item) => (
                  <li key={item.to}>
                    <PrimaryNavLink item={item} />
                  </li>
                ))}
                {isAdmin && (
                  <li>
                    <ToolsMenu />
                  </li>
                )}
              </ul>
            </div>
            <div className="flex items-center gap-1">
              <div className="hidden md:block">
                <LanguageSwitcher value={locale} onChange={handleLocaleChange} />
              </div>
              <ThemePicker
                mode={mode}
                colorTheme={colorTheme}
                onModeChange={handleModeChange}
                onColorThemeChange={handleColorThemeChange}
              />
              <Link
                to="/settings"
                aria-label={t('nav.settings')}
                title={t('nav.settings')}
                aria-current={settingsActive ? 'page' : undefined}
                className={cn(iconButtonClass(settingsActive), 'hidden sm:flex')}
              >
                <Settings size={18} aria-hidden="true" />
              </Link>
              {currentUser && <UserMenu username={currentUser.username} />}
              <button
                type="button"
                disabled={!!pipelineRunning}
                onClick={() =>
                  triggerPipeline()
                    .then((res) =>
                      toast.success(
                        res.status === 'duplicate'
                          ? t('discover.scanAlreadyRunning')
                          : res.queued
                            ? t('discover.scanQueued').replace('{0}', String(res.position ?? 0))
                            : t('discover.scanStarted'),
                      ),
                    )
                    .catch((err) => {
                      toast.error(errMsg(err))
                    })
                }
                className="ml-1 flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-control bg-accent px-3 py-1.5 text-body font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-ring disabled:opacity-60 md:min-h-9 lg:px-4"
              >
                {pipelineRunning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                    <span className="hidden lg:inline">{t('app.scanning')}</span>
                    <span className="lg:hidden">{t('app.scan')}</span>
                  </>
                ) : (
                  <>
                    <span className="hidden lg:inline">{t('app.runScan')}</span>
                    <span className="lg:hidden">{t('app.scan')}</span>
                  </>
                )}
              </button>
              {/* Mobile: language and admin tools; daily pages live in the bottom nav */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                className={cn(iconButtonClass(menuOpen), 'md:hidden')}
                aria-label={t('app.toggleMenu')}
              >
                <MobileMenuIcon open={menuOpen} />
              </button>
            </div>
          </div>
          {menuOpen && (
            <div id="mobile-menu" className="flex flex-col gap-1 pb-2 pt-3 md:hidden">
              <div className="flex items-center gap-2 px-2 py-1 text-body text-muted">
                <LanguageSwitcher
                  value={locale}
                  onChange={handleLocaleChange}
                  placement="bottom-start"
                  testId="language-switcher-mobile"
                />
                <span lang={locale}>{getLocaleLabel(locale)}</span>
              </div>
              <Link
                to="/settings"
                aria-current={settingsActive ? 'page' : undefined}
                className={cn(navItemClass(settingsActive), 'min-h-11 w-full sm:hidden')}
              >
                <Settings size={16} aria-hidden="true" />
                {t('nav.settings')}
              </Link>
              {isAdmin && (
                <>
                  <p className="px-2 pt-2 text-caption text-muted">{t('nav.tools')}</p>
                  <ul className="flex flex-col">
                    {TOOLS_NAV.map((item) => {
                      const active = item.isActive(location)
                      return (
                        <li key={item.to}>
                          <Link
                            to={item.to}
                            aria-current={active ? 'page' : undefined}
                            className={cn(navItemClass(active), 'min-h-11 w-full')}
                          >
                            <item.icon size={16} aria-hidden="true" />
                            {t(item.labelKey)}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </nav>
        {/* Clears the fixed bottom nav, home-indicator inset and preview player */}
        <main id="main-content" tabIndex={-1} className="pb-(--bottom-stack) focus:outline-none">
          {children}
        </main>
        <BottomNav />
        <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <PreviewPlayer
          playing={preview.state.playing}
          artistName={preview.state.artistName}
          source={preview.state.source}
          loading={preview.state.loading}
          onStop={audition.active ? audition.stop : preview.stop}
          spotify={{
            command: preview.spotifyCommand,
            onPlaybackStarted: preview.onSpotifyPlaybackStarted,
            onPlaybackPaused: preview.onSpotifyPlaybackPaused,
            onPlaybackUnavailable: preview.onSpotifyPlaybackUnavailable,
            onPlaybackEnded: preview.onSpotifyPlaybackEnded,
          }}
          volume={preview.volume}
          onVolumeChange={preview.setVolume}
          queue={
            audition.active
              ? {
                  index: audition.index,
                  count: audition.count,
                  onNext: audition.next,
                  onPrevious: audition.previous,
                }
              : undefined
          }
        />
        <footer className="hidden md:block fixed bottom-[calc(var(--player-offset)+0.5rem)] right-3 text-micro text-muted select-none pointer-events-none z-10">
          v{VERSION}
          {CHANNEL === 'nightly' ? ` (${GIT_SHA.slice(0, 7)})` : ''}
        </footer>
      </div>
    </PreviewContext.Provider>
  )
}

// Inner app - only mounts after AuthGate has resolved auth
function InnerApp() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)

  useEffect(() => {
    getSetupStatus()
      .then((s) => setSetupComplete(s.setupComplete))
      .catch(() => setSetupComplete(false))
  }, [])

  if (setupComplete === null) return null

  if (!setupComplete) {
    return (
      <>
        <SetupWizard onComplete={() => setSetupComplete(true)} />
        <Toaster
          theme="system"
          offset={{ bottom: 'calc(var(--bottom-stack) + 1.5rem)' }}
          mobileOffset={{ bottom: 'calc(var(--bottom-stack) + 0.75rem)' }}
        />
      </>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppShell>
            <Suspense
              fallback={<div className="p-6 text-sm text-muted">{/* lazy route loading */}</div>}
            >
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/discover/modes" element={<DiscoveryModesPage />} />
                <Route path="/genres" element={<GenresPage />} />
                <Route path="/genres/:slug" element={<GenreDetailPage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route
                  path="/library"
                  element={
                    <AdminRoute>
                      <LibraryPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/library/health"
                  element={
                    <AdminRoute>
                      <LibraryPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/library/reconciliation"
                  element={
                    <AdminRoute>
                      <LibraryPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <AdminRoute>
                      <AnalyticsPage />
                    </AdminRoute>
                  }
                />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/settings/jobs"
                  element={<Navigate to="/settings?tab=system#jobs" replace />}
                />
                <Route
                  path="/settings/system-health"
                  element={<Navigate to="/settings?tab=system#health" replace />}
                />
                <Route
                  path="/users"
                  element={
                    <AdminRoute>
                      <UserManagementPage />
                    </AdminRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Suspense>
          </AppShell>
        </ErrorBoundary>
        <Toaster
          theme="system"
          offset={{ bottom: 'calc(var(--bottom-stack) + 1.5rem)' }}
          mobileOffset={{ bottom: 'calc(var(--bottom-stack) + 0.75rem)' }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export function App() {
  // Apply theme immediately on mount (before first render flicker)
  useEffect(() => {
    applyTheme(getStoredColorTheme(), getStoredMode())
  }, [])

  return (
    <AuthGate>
      <InnerApp />
    </AuthGate>
  )
}

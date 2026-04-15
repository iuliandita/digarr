import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  ChevronDown,
  Compass,
  HeartPulse,
  LayoutDashboard,
  ListMusic,
  LogOut,
  Monitor,
  Moon,
  Music,
  RefreshCw,
  Search,
  Settings,
  Sun,
  User,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { normalizeLocale, type SupportedLocale } from '@/core/i18n/locales'
import { errMsg } from '@/core/validation'
import { VERSION } from '@/version'
import { AuthGate } from './components/auth-gate'
import { BottomNav } from './components/bottom-nav'
import { ErrorBoundary } from './components/error-boundary'
import { KeyboardShortcuts } from './components/keyboard-shortcuts'
import { LanguageSwitcher } from './components/language-switcher'
import { PreviewPlayer } from './components/preview-player'
import { useClickOutside } from './hooks/use-click-outside'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
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
import { PreviewContext } from './lib/preview-context'
import { queryClient } from './lib/query-client'
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
import { AnalyticsPage } from './pages/analytics'
import { Dashboard } from './pages/dashboard'
import { DiscoverPage } from './pages/discover'
import { DiscoveryModesPage } from './pages/discovery-modes'
import { GenreDetailPage } from './pages/genre-detail'
import { GenresPage } from './pages/genres'
import { LibraryHealthPage } from './pages/library-health'
import { LibraryReconciliationPage } from './pages/library-reconciliation'
import { PlaylistDetailPage } from './pages/playlist-detail'
import { PlaylistsPage } from './pages/playlists'
import { SearchPage } from './pages/search'
import { SettingsPage } from './pages/settings'
import { SetupWizard } from './pages/setup'
import SubscriptionsPage from './pages/subscriptions'
import { UserManagementPage } from './pages/user-management'

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

// Nav dropdown

function NavDropdown({
  label,
  icon,
  items,
}: {
  label: string
  icon: React.ReactNode
  items: { to: string; label: string; icon: React.ReactNode; end?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useClickOutside(ref, () => setOpen(false), open)

  const isActive = items.some((item) => {
    const path = item.to.split('?')[0]
    return item.end
      ? location.pathname === path
      : location.pathname === path || location.pathname.startsWith(`${path}/`)
  })

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1 text-sm transition-colors ${isActive ? 'text-accent' : 'text-muted hover:text-text'}`}
      >
        {icon} {label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-lg py-1 z-50"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={({ isActive: active }) =>
                `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${active ? 'text-accent bg-accent/5' : 'text-text hover:bg-bg'}`
              }
            >
              {item.icon} {item.label}
            </NavLink>
          ))}
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, () => setOpen(false), open)

  const ModeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1.5 text-muted hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        aria-label={t('app.themeSettings')}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('app.theme')}
      >
        <ModeIcon size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-50 py-1"
        >
          <div className="px-3 py-1.5 text-micro uppercase tracking-wider text-muted">
            {t('app.themeMode')}
          </div>
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
                role="menuitem"
                onClick={() => onModeChange(m)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px] ${mode === m ? 'text-accent' : 'text-text'}`}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            )
          })}
          <div className="border-t border-border my-1" />
          <div className="max-h-[320px] overflow-y-auto">
            {(['Editor', 'Streaming'] as const).map((group) => (
              <div key={group}>
                <div className="px-3 py-1.5 text-micro uppercase tracking-wider text-muted sticky top-0 bg-surface">
                  {group === 'Editor' ? t('app.themeGroupEditor') : t('app.themeGroupStreaming')}
                </div>
                {COLOR_THEMES.filter((t) => t.group === group).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    onClick={() => onColorThemeChange(t.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px] ${colorTheme === t.id ? 'text-accent' : 'text-text'}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    {t.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu({ username }: { username: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, () => setOpen(false), open)

  async function handleLogout() {
    try {
      await logoutUser()
    } catch {
      // Session might already be invalid
    }
    clearStoredToken()
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 p-1.5 text-muted hover:text-text transition-colors"
        title={username}
      >
        <User size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-sm font-medium text-text truncate">{username}</p>
          </div>
          <NavLink
            to="/settings?tab=account"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-text hover:bg-bg transition-colors"
          >
            <Settings size={14} />
            {t('app.userMenu.settings')}
          </NavLink>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-text hover:bg-bg transition-colors"
          >
            <LogOut size={14} />
            {t('app.userMenu.logout')}
          </button>
        </div>
      )}
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setModeState] = useState<Mode>(getStoredMode)
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(getStoredColorTheme)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const preview = usePreview()
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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'text-text' : 'text-muted hover:text-text'

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `py-2 ${isActive ? 'text-text' : 'text-muted hover:text-text'}`

  return (
    <PreviewContext.Provider
      value={{
        play: preview.play,
        stop: preview.stop,
        hasPreview: preview.hasPreview,
        currentMbid: preview.state.artistMbid,
        playing: preview.state.playing,
        globalPlayId: preview.globalPlayId,
      }}
    >
      <div className="min-h-screen bg-bg">
        <nav
          className="border-b border-border px-4 sm:px-6 py-3"
          aria-label={t('app.mainNavigation')}
        >
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-6">
              <NavLink to="/" className="text-xl font-bold text-accent hover:opacity-90">
                digarr
              </NavLink>
              {/* Desktop nav links - grouped */}
              <div className="hidden sm:flex items-center gap-4">
                <NavLink to="/" end className={navLinkClass}>
                  <span className="flex items-center gap-1">
                    <LayoutDashboard size={14} aria-hidden="true" />
                    {t('nav.dashboard')}
                  </span>
                </NavLink>
                <NavLink to="/search" className={navLinkClass}>
                  <span className="flex items-center gap-1">
                    <Search size={14} aria-hidden="true" />
                    {t('nav.search')}
                  </span>
                </NavLink>
                <NavDropdown
                  label={t('nav.discover')}
                  icon={<Compass size={14} aria-hidden="true" />}
                  items={[
                    {
                      to: '/discover',
                      end: true,
                      label: t('nav.recommendations'),
                      icon: <Compass size={14} />,
                    },
                    {
                      to: '/discover/modes',
                      end: true,
                      label: t('nav.discoveryModes'),
                      icon: <Compass size={14} />,
                    },
                    { to: '/genres', label: t('nav.genres'), icon: <Music size={14} /> },
                    {
                      to: '/subscriptions',
                      label: t('nav.subscriptions'),
                      icon: <Monitor size={14} />,
                    },
                    { to: '/playlists', label: t('nav.playlists'), icon: <ListMusic size={14} /> },
                  ]}
                />
                {currentUser?.isAdmin && (
                  <NavDropdown
                    label={t('nav.library')}
                    icon={<HeartPulse size={14} aria-hidden="true" />}
                    items={[
                      {
                        to: '/library/health',
                        label: t('nav.health'),
                        icon: <HeartPulse size={14} />,
                      },
                      {
                        to: '/library/reconciliation',
                        label: t('nav.reconciliation'),
                        icon: <RefreshCw size={14} />,
                      },
                      {
                        to: '/analytics',
                        label: t('nav.analytics'),
                        icon: <BarChart3 size={14} />,
                      },
                    ]}
                  />
                )}
                <NavLink to="/settings" className={navLinkClass}>
                  <span className="flex items-center gap-1">
                    <Settings size={14} aria-hidden="true" />
                    {t('nav.settings')}
                  </span>
                </NavLink>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher value={locale} onChange={handleLocaleChange} />
              <ThemePicker
                mode={mode}
                colorTheme={colorTheme}
                onModeChange={handleModeChange}
                onColorThemeChange={handleColorThemeChange}
              />
              {currentUser && <UserMenu username={currentUser.username} />}
              <button
                type="button"
                disabled={!!pipelineRunning}
                onClick={() =>
                  triggerPipeline()
                    .then(() => toast.success(t('discover.scanStarted')))
                    .catch((err) => {
                      const msg = errMsg(err)
                      toast.error(msg.includes('409') ? t('discover.scanAlreadyRunning') : msg)
                    })
                }
                className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {pipelineRunning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span className="hidden sm:inline">{t('app.scanning')}</span>
                    <span className="sm:hidden">{t('app.scan')}</span>
                  </>
                ) : (
                  <>
                    <span className="hidden sm:inline">{t('app.runScan')}</span>
                    <span className="sm:hidden">{t('app.scan')}</span>
                  </>
                )}
              </button>
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="sm:hidden p-1"
                aria-label={t('app.toggleMenu')}
              >
                <MobileMenuIcon open={menuOpen} />
              </button>
            </div>
          </div>
          {/* Mobile nav dropdown */}
          {menuOpen && (
            <div className="sm:hidden flex flex-col gap-1 pt-3 pb-1">
              <NavLink to="/" end className={mobileNavLinkClass} onClick={() => setMenuOpen(false)}>
                <span className="flex items-center gap-1.5">
                  <LayoutDashboard size={14} aria-hidden="true" />
                  {t('nav.dashboard')}
                </span>
              </NavLink>
              <NavLink
                to="/search"
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Search size={14} aria-hidden="true" />
                  {t('nav.search')}
                </span>
              </NavLink>
              <NavLink
                to="/discover"
                end
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Compass size={14} aria-hidden="true" />
                  {t('nav.discover')}
                </span>
              </NavLink>
              <NavLink
                to="/discover/modes"
                end
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Compass size={14} aria-hidden="true" />
                  {t('nav.discoveryModes')}
                </span>
              </NavLink>
              <NavLink
                to="/genres"
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Music size={14} aria-hidden="true" />
                  {t('nav.genres')}
                </span>
              </NavLink>
              <NavLink
                to="/playlists"
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <ListMusic size={14} aria-hidden="true" />
                  {t('nav.playlists')}
                </span>
              </NavLink>
              <NavLink
                to="/subscriptions"
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Monitor size={14} aria-hidden="true" />
                  {t('nav.subscriptions')}
                </span>
              </NavLink>
              {currentUser?.isAdmin && (
                <NavLink
                  to="/library/health"
                  className={mobileNavLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="flex items-center gap-1.5">
                    <HeartPulse size={14} aria-hidden="true" />
                    {t('nav.library')}
                  </span>
                </NavLink>
              )}
              {currentUser?.isAdmin && (
                <NavLink
                  to="/library/reconciliation"
                  className={mobileNavLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="flex items-center gap-1.5">
                    <RefreshCw size={14} aria-hidden="true" />
                    {t('nav.reconciliation')}
                  </span>
                </NavLink>
              )}
              {currentUser?.isAdmin && (
                <NavLink
                  to="/analytics"
                  className={mobileNavLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="flex items-center gap-1.5">
                    <BarChart3 size={14} aria-hidden="true" />
                    {t('nav.analytics')}
                  </span>
                </NavLink>
              )}
              <NavLink
                to="/settings"
                className={mobileNavLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex items-center gap-1.5">
                  <Settings size={14} aria-hidden="true" />
                  {t('nav.settings')}
                </span>
              </NavLink>
              {currentUser?.isAdmin && (
                <NavLink
                  to="/users"
                  className={mobileNavLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="flex items-center gap-1.5">
                    <Users size={14} aria-hidden="true" />
                    {t('nav.users')}
                  </span>
                </NavLink>
              )}
            </div>
          )}
        </nav>
        {/* Main content - add pb-16 on mobile so bottom nav doesn't overlap */}
        <main className="pb-16 md:pb-0">{children}</main>
        <BottomNav />
        <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <PreviewPlayer
          playing={preview.state.playing}
          artistName={preview.state.artistName}
          source={preview.state.source}
          loading={preview.state.loading}
          onStop={preview.stop}
        />
        <footer className="hidden md:block fixed bottom-2 right-3 text-micro text-muted select-none pointer-events-none z-10">
          v{VERSION}
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
        <Toaster theme="system" />
      </>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppShell>
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
              <Route path="/library/health" element={<LibraryHealthPage />} />
              <Route path="/library/reconciliation" element={<LibraryReconciliationPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/jobs" element={<Navigate to="/settings?tab=jobs" replace />} />
              <Route
                path="/settings/system-health"
                element={<Navigate to="/settings?tab=system-health" replace />}
              />
              <Route path="/users" element={<UserManagementPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </AppShell>
        </ErrorBoundary>
        <Toaster theme="system" />
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

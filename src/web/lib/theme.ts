export type Mode = 'dark' | 'light' | 'system'

export type ColorTheme =
  | 'digarr'
  | 'tokyonight'
  | 'catppuccin'
  | 'dracula'
  | 'nord'
  | 'gruvbox'
  | 'solarized'
  | 'rosepine'
  | 'onedark'
  | 'spotarr'
  | 'youtarr'
  | 'deezarr'
  | 'amazarr'
  | 'qobuzarr'
  | 'applarr'
  | 'tidarr'

export const COLOR_THEMES: { id: ColorTheme; name: string; group?: string }[] = [
  // Project signature
  { id: 'digarr', name: 'Digarr', group: 'Project' },
  // Editor themes
  { id: 'tokyonight', name: 'Tokyo Night', group: 'Editor' },
  { id: 'catppuccin', name: 'Catppuccin', group: 'Editor' },
  { id: 'dracula', name: 'Dracula', group: 'Editor' },
  { id: 'nord', name: 'Nord', group: 'Editor' },
  { id: 'gruvbox', name: 'Gruvbox', group: 'Editor' },
  { id: 'solarized', name: 'Solarized', group: 'Editor' },
  { id: 'rosepine', name: 'Rose Pine', group: 'Editor' },
  { id: 'onedark', name: 'One Dark', group: 'Editor' },
  // *arr streaming themes
  { id: 'spotarr', name: 'Spotarr', group: 'Streaming' },
  { id: 'youtarr', name: 'Youtarr', group: 'Streaming' },
  { id: 'deezarr', name: 'Deezarr', group: 'Streaming' },
  { id: 'amazarr', name: 'Amazarr', group: 'Streaming' },
  { id: 'qobuzarr', name: 'Qobuzarr', group: 'Streaming' },
  { id: 'applarr', name: 'Applarr', group: 'Streaming' },
  { id: 'tidarr', name: 'Tidarr', group: 'Streaming' },
]

const MODE_KEY = 'digarr-theme'
const COLOR_KEY = 'digarr-color-theme'

// Keep backward compat: old 'dark'/'light' values still work as Mode
export function getStoredMode(): Mode {
  const stored = localStorage.getItem(MODE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  return 'system'
}

export function setStoredMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export function getStoredColorTheme(): ColorTheme {
  const stored = localStorage.getItem(COLOR_KEY)
  if (COLOR_THEMES.some((t) => t.id === stored)) return stored as ColorTheme
  return 'youtarr'
}

export function setStoredColorTheme(theme: ColorTheme): void {
  localStorage.setItem(COLOR_KEY, theme)
}

export function resolveMode(mode: Mode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

export function applyTheme(colorTheme: ColorTheme, mode: Mode): void {
  const resolved = resolveMode(mode)
  document.documentElement.setAttribute('data-theme', `${colorTheme}-${resolved}`)
}

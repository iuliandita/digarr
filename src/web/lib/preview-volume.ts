// Shared preview volume, persisted to localStorage so it survives reloads and
// is consistent across both audio systems (the global Deezer preview and the
// per-card TopTracks previews).

export const PREVIEW_VOLUME_KEY = 'digarr:preview-volume'
export const DEFAULT_PREVIEW_VOLUME = 0.8

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_VOLUME
  return Math.max(0, Math.min(1, value))
}

export function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_VOLUME_KEY)
    if (raw === null) return DEFAULT_PREVIEW_VOLUME
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) return clampVolume(parsed)
  } catch {
    // ignore storage access errors (private mode, disabled storage)
  }
  return DEFAULT_PREVIEW_VOLUME
}

export function writeStoredVolume(value: number): void {
  try {
    localStorage.setItem(PREVIEW_VOLUME_KEY, String(clampVolume(value)))
  } catch {
    // ignore
  }
}

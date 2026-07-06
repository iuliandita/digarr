export const QUALITY_PREFERENCES = [
  'lossless_only',
  'flac_preferred',
  'lossy_fallback',
  'any_audio',
] as const
export type QualityPreference = (typeof QUALITY_PREFERENCES)[number]

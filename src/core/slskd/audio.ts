const AUDIO_EXTENSIONS = new Set([
  'flac',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'alac',
  'wma',
])

export function getSupportedAudioExtension(filename: string): string | null {
  const extension = filename.split('.').at(-1)?.toLowerCase()
  return extension && AUDIO_EXTENSIONS.has(extension) ? extension : null
}

export function isSupportedAudioFile(filename: string): boolean {
  return getSupportedAudioExtension(filename) !== null
}

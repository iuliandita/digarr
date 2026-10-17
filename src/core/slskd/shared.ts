export function normalizeInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function splitRemotePath(filename: string): string[] {
  return filename.split(/[\\/]+/).filter(Boolean)
}

export function remoteDirectory(filename: string): string {
  return splitRemotePath(filename).slice(0, -1).join('\\')
}

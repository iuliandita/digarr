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

// Automatic retries after the first attempt; waits grow per retry.
export const SLSKD_MAX_AUTO_RETRIES = 3
export const SLSKD_RETRY_BACKOFF_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]
const SLSKD_MAX_FAILED_RELEASES = 20

export type SlskdFailedRelease = { username: string; directory: string }

export function readFailedReleases(selected: Record<string, unknown> | null): SlskdFailedRelease[] {
  if (!selected || !Array.isArray(selected.failedReleases)) return []
  return selected.failedReleases.flatMap((raw): SlskdFailedRelease[] => {
    const row = raw as Record<string, unknown> | null
    if (!row || typeof row.username !== 'string' || typeof row.directory !== 'string') return []
    return row.username && row.directory
      ? [{ username: row.username, directory: row.directory }]
      : []
  })
}

// The release a failed attempt had selected, plus every earlier failure carried forward.
export function collectFailedReleases(
  selected: Record<string, unknown> | null,
): SlskdFailedRelease[] {
  const failed = readFailedReleases(selected)
  if (selected && typeof selected.username === 'string' && Array.isArray(selected.files)) {
    const username = selected.username
    for (const file of selected.files) {
      const filename = (file as { filename?: unknown } | null)?.filename
      if (typeof filename !== 'string') continue
      const directory = remoteDirectory(filename)
      if (directory && !failed.some((f) => f.username === username && f.directory === directory)) {
        failed.push({ username, directory })
      }
    }
  }
  return failed.slice(-SLSKD_MAX_FAILED_RELEASES)
}

export function isFailedRelease(
  candidate: {
    username: string
    filename: string
    directories?: string[]
    files?: Array<{ filename: string }>
  },
  failed: SlskdFailedRelease[],
): boolean {
  if (failed.length === 0) return false
  const directories = new Set(
    candidate.directories?.length
      ? candidate.directories
      : (candidate.files ?? [{ filename: candidate.filename }]).map((file) =>
          remoteDirectory(file.filename),
        ),
  )
  return failed.some((f) => f.username === candidate.username && directories.has(f.directory))
}

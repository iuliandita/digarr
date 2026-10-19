export type ImageEntry = { coverType: string; remoteUrl?: string }

export type ImageResult = { url?: string; logoUrl?: string }

const HTTPS_CAPABLE_IMAGE_HOSTS = /^(assets\.fanart\.tv|(www\.|r2\.|img\.)?theaudiodb\.com)$/i

/** Upgrade http:// to https:// for hosts known to serve images over both; others are left alone. */
export function toHttpsImageUrl(url: string | undefined): string | undefined {
  if (!url?.toLowerCase().startsWith('http://')) return url
  try {
    const parsed = new URL(url)
    if (!HTTPS_CAPABLE_IMAGE_HOSTS.test(parsed.hostname)) return url
    parsed.protocol = 'https:'
    return parsed.href
  } catch {
    return url
  }
}

/** Extract best image + logo from Lidarr/SkyHook-shaped image arrays. */
export function extractImages(images: ImageEntry[]): ImageResult {
  const logo = images.find((i) => i.coverType === 'clearlogo' && i.remoteUrl)
  const logoUrl = toHttpsImageUrl(logo?.remoteUrl)
  for (const type of ['poster', 'fanart', 'banner']) {
    const img = images.find((i) => i.coverType === type && i.remoteUrl)
    if (img?.remoteUrl) return { url: toHttpsImageUrl(img.remoteUrl), logoUrl }
  }
  const fallback = images.find((i) => i.coverType !== 'clearlogo' && i.remoteUrl)
  return fallback?.remoteUrl ? { url: toHttpsImageUrl(fallback.remoteUrl), logoUrl } : { logoUrl }
}

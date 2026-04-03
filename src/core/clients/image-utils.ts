export type ImageEntry = { coverType: string; remoteUrl?: string }

export type ImageResult = { url?: string; logoUrl?: string }

/** Extract best image + logo from Lidarr/SkyHook-shaped image arrays. */
export function extractImages(images: ImageEntry[]): ImageResult {
  const logo = images.find((i) => i.coverType === 'clearlogo' && i.remoteUrl)
  const logoUrl = logo?.remoteUrl
  for (const type of ['poster', 'fanart', 'banner']) {
    const img = images.find((i) => i.coverType === type && i.remoteUrl)
    if (img?.remoteUrl) return { url: img.remoteUrl, logoUrl }
  }
  const fallback = images.find((i) => i.coverType !== 'clearlogo' && i.remoteUrl)
  return fallback?.remoteUrl ? { url: fallback.remoteUrl, logoUrl } : { logoUrl }
}

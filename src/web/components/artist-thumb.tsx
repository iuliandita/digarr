import { useState } from 'react'
import { hueFromName } from '../lib/utils'

const AUDIODB_HOSTS = new Set(['img.theaudiodb.com', 'theaudiodb.com', 'www.theaudiodb.com'])
const PROXY_FLAG_KEY = 'digarr:audiodbProxyImages'

export function setAudiodbProxyFlag(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PROXY_FLAG_KEY, enabled ? '1' : '0')
  } catch {
    // storage unavailable; proxy just won't kick in
  }
}

function readProxyFlag(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PROXY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function resolveSrc(url: string | null | undefined, proxy: boolean): string | undefined {
  if (!url) return undefined
  if (!proxy) return url
  try {
    const u = new URL(url)
    if (AUDIODB_HOSTS.has(u.hostname)) {
      return `/api/v1/media/image-proxy?src=${encodeURIComponent(url)}`
    }
  } catch {
    // fall through
  }
  return url
}

// ArtistThumb

/**
 * Artist avatar: shows the image if available, falls back to a colored
 * two-letter placeholder derived from the artist name.
 *
 * size - grid unit (Tailwind style, multiplied by 4 to get px). Default: 10.
 */
export function ArtistThumb({
  name,
  imageUrl,
  size = 10,
  fill,
  className,
}: {
  name: string
  imageUrl?: string | null
  size?: number
  /** When true, uses w-full h-full instead of fixed pixel sizes. */
  fill?: boolean
  className?: string
}) {
  const [imgError, setImgError] = useState(false)
  const resolvedSrc = resolveSrc(imageUrl ?? null, readProxyFlag())
  const px = size * 4
  const hue = hueFromName(name)

  const sizeStyle = fill ? undefined : { width: `${px}px`, height: `${px}px` }
  const sizeClass = fill ? 'w-full h-full' : 'shrink-0'

  if (resolvedSrc && !imgError) {
    return (
      <img
        src={resolvedSrc}
        alt={name}
        loading="lazy"
        decoding="async"
        className={`rounded-md object-cover bg-bg ${sizeClass} ${className ?? ''}`}
        style={sizeStyle}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div
      className={`rounded-md flex items-center justify-center font-bold text-bg ${sizeClass} ${className ?? ''}`}
      style={{
        ...sizeStyle,
        background: `hsl(${hue}, 40%, 45%)`,
        fontSize: fill ? undefined : `${Math.max(size * 1.5, 12)}px`,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

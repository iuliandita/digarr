import { useState } from 'react'
import { hueFromName } from '../lib/utils'

// ArtistThumb

/**
 * Artist avatar: shows the image if available, falls back to a colored
 * two-letter placeholder derived from the artist name.
 *
 * size -- grid unit (Tailwind style, multiplied by 4 to get px). Default: 10.
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
  const px = size * 4
  const hue = hueFromName(name)

  const sizeStyle = fill ? undefined : { width: `${px}px`, height: `${px}px` }
  const sizeClass = fill ? 'w-full h-full' : 'shrink-0'

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
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

import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['micro', 'caption', 'small', 'body', 'lead', 'title', 'headline', 'display'],
        },
      ],
      rounded: [{ rounded: ['control', 'surface'] }],
      shadow: [{ shadow: ['raised', 'menu', 'dialog'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Deterministic hue (0-359) from a string. Used for placeholder backgrounds. */
export function hueFromName(name: string): number {
  return Math.abs([...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360)
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

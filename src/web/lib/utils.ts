import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'micro-sm', 'micro-lg'] }],
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

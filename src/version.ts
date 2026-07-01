import pkg from '../package.json'

export const VERSION = pkg.version

// Stamped at build time via Docker build-args -> ENV (Bun inlines process.env.*).
// On the web side, Vite `define` replaces these same identifiers (see vite.config.ts).
export const GIT_SHA = process.env.DIGARR_GIT_SHA ?? 'dev'
export const CHANNEL = process.env.DIGARR_CHANNEL ?? 'local'

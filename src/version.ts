import pkg from '../package.json'

export const VERSION = pkg.version

// Docker build args become runtime ENV values for the backend container.
// On the web side, Vite `define` replaces these identifiers at build time.
export const GIT_SHA = process.env.DIGARR_GIT_SHA ?? 'dev'
export const CHANNEL = process.env.DIGARR_CHANNEL ?? 'local'

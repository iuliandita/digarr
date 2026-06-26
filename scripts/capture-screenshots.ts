#!/usr/bin/env bun

/**
 * Capture documentation screenshots from a running Digarr instance.
 *
 * Usage:
 *   DIGARR_URL=https://example.com \
 *   DIGARR_USER=admin \
 *   DIGARR_PASS=secret \
 *   bun scripts/capture-screenshots.ts
 *
 * Optional:
 *   OUT_DIR=docs/screenshots      # default
 *   COLOR_THEME=youtarr            # default (see src/web/lib/theme.ts)
 *   VIEWPORT_WIDTH=1280            # default
 *   VIEWPORT_HEIGHT=800            # default
 *   DEVICE_SCALE=2                 # default (retina-crisp PNGs)
 *   ONLY=library-sources,settings  # restrict to specific files
 *
 * The script logs in, applies the color theme, sanitizes the DOM to remove
 * the logged-in username, email addresses, and the instance hostname from any
 * visible text, masks URL / token / password / labelled-credential input
 * values, and saves PNGs to OUT_DIR.
 *
 * The script keeps credentials out of the repo - everything comes from env.
 */

import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from '@playwright/test'

const BASE_URL = process.env.DIGARR_URL
const USERNAME = process.env.DIGARR_USER
const PASSWORD = process.env.DIGARR_PASS
const OUT_DIR = process.env.OUT_DIR ?? 'docs/screenshots'
const COLOR_THEME = process.env.COLOR_THEME ?? 'youtarr'
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH ?? '1280')
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT ?? '800')
const DEVICE_SCALE = Number(process.env.DEVICE_SCALE ?? '2')
const ONLY = process.env.ONLY?.split(',').map((s) => s.trim()) ?? null

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('Missing env: DIGARR_URL, DIGARR_USER, DIGARR_PASS')
  process.exit(1)
}

type PageSpec = {
  file: string
  /** Navigate to this path. If `onPage` is set, navigation is skipped. */
  path?: string
  theme: 'dark' | 'light'
  /** Optional hook to run after navigation and before screenshot. */
  onPage?: (page: Page) => Promise<void>
}

const specs: PageSpec[] = [
  { path: '/', file: 'dashboard-dark.png', theme: 'dark' },
  { path: '/', file: 'dashboard-light.png', theme: 'light' },
  { path: '/discover', file: 'discover.png', theme: 'dark' },
  { path: '/discover/modes', file: 'discovery-modes.png', theme: 'dark' },
  { path: '/search', file: 'search.png', theme: 'dark' },
  { path: '/genres', file: 'genres.png', theme: 'dark' },
  // genre-detail is inserted dynamically after finding a slug
  { path: '/playlists', file: 'playlists.png', theme: 'dark' },
  { path: '/subscriptions', file: 'subscriptions.png', theme: 'dark' },
  { path: '/library/health', file: 'library-health.png', theme: 'dark' },
  {
    path: '/library/health',
    file: 'library-sources.png',
    theme: 'dark',
    onPage: async (page) => {
      const heading = page
        .locator('h2, h3, h4')
        .filter({ hasText: /Library Sources/i })
        .first()
      if (await heading.count()) {
        await heading.scrollIntoViewIfNeeded()
        await page.waitForTimeout(300)
        await page.evaluate(() => window.scrollBy(0, -40))
        await page.waitForTimeout(300)
      } else {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(300)
      }
    },
  },
  { path: '/library/reconciliation', file: 'library-reconciliation.png', theme: 'dark' },
  { path: '/analytics', file: 'analytics.png', theme: 'dark' },
  { path: '/settings', file: 'settings.png', theme: 'dark' },
  { path: '/settings?tab=blocked', file: 'settings-blocked.png', theme: 'dark' },
]

await mkdir(OUT_DIR, { recursive: true })

const hostPatterns: string[] = []
try {
  const u = new URL(BASE_URL)
  hostPatterns.push(u.host, u.hostname)
  const apex = u.hostname.split('.').slice(-2).join('.')
  if (apex && apex !== u.hostname) hostPatterns.push(apex)
} catch {}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  deviceScaleFactor: DEVICE_SCALE,
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

console.log('Logging in...')
await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('load')
await page.locator('input[name="username"], input[type="text"]').first().fill(USERNAME)
await page.locator('input[type="password"]').first().fill(PASSWORD)
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }),
  page.locator('button[type="submit"]').first().click(),
])
console.log('Logged in.')

async function setTheme(theme: 'dark' | 'light') {
  await page.evaluate(
    ([t, c]) => {
      const root = document.documentElement
      if (t === 'dark') root.classList.add('dark')
      else root.classList.remove('dark')
      root.setAttribute('data-theme', `${c}-${t}`)
      try {
        localStorage.setItem('digarr-theme', t)
        localStorage.setItem('digarr-color-theme', c)
      } catch {}
    },
    [theme, COLOR_THEME],
  )
}

async function sanitize() {
  await page.evaluate(
    ([u, pats]) => {
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const uRe = u ? new RegExp(`\\b${escapeRe(u)}\\b`, 'g') : null
      // Email addresses anywhere in visible text or attributes.
      const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
      const patRes = (pats as string[])
        .filter(Boolean)
        .map((p) => ({ re: new RegExp(escapeRe(p), 'g'), replacement: 'example.com' }))
      const scrubText = (input: string) => {
        let val = input.replace(emailRe, 'user@example.com')
        if (uRe) val = val.replace(uRe, 'user')
        for (const { re, replacement } of patRes) val = val.replace(re, replacement)
        return val
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const toReplace: [Text, string][] = []
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (!node.nodeValue) continue
        const val = scrubText(node.nodeValue)
        if (val !== node.nodeValue) toReplace.push([node, val])
      }
      for (const [node, val] of toReplace) node.nodeValue = val
      // Resolve the effective label for an input so credential/account fields can be
      // masked even when their value isn't obviously a URL/token (e.g. a service username).
      const labelText = (input: HTMLInputElement) => {
        const parts = [
          input.getAttribute('aria-label') || '',
          input.placeholder || '',
          input.name,
          input.id,
        ]
        if (input.id) {
          try {
            const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            if (l) parts.push(l.textContent || '')
          } catch {}
        }
        const wrap = input.closest('div')
        if (wrap) {
          const l = wrap.querySelector('label')
          if (l) parts.push(l.textContent || '')
        }
        return parts.join(' ').toLowerCase()
      }
      const sensitiveLabel = /user|account|e-?mail|client|token|secret|\bapi\b|\bkey\b|password/i
      // Mask form input values: URLs, tokens, emails, password fields, and labelled credentials.
      for (const input of document.querySelectorAll('input')) {
        const el = input as HTMLInputElement
        const v = el.value || ''
        const isPw = el.type === 'password'
        if (!v && !isPw) continue
        const isUrl = el.type === 'url' || /^https?:\/\//i.test(v) || /\.local|\.lan/i.test(v)
        const isToken = /^[A-Za-z0-9_-]{20,}$/.test(v)
        emailRe.lastIndex = 0
        const isEmail = emailRe.test(v)
        if (isUrl) {
          el.value = ''
          el.setAttribute('placeholder', 'https://example.com')
        } else if (isPw || isToken || isEmail) {
          el.value = ''
          el.setAttribute('placeholder', isEmail ? 'user@example.com' : 'REDACTED')
        } else if (sensitiveLabel.test(labelText(el))) {
          el.value = ''
          el.setAttribute('placeholder', 'redacted')
        }
      }
      // Scrub username/email out of attributes that leak into tooltips.
      for (const el of document.querySelectorAll('[title], [aria-label]')) {
        for (const attr of ['title', 'aria-label']) {
          const t = el.getAttribute(attr)
          if (t) {
            const scrubbed = scrubText(t)
            if (scrubbed !== t) el.setAttribute(attr, scrubbed)
          }
        }
      }
    },
    [USERNAME, hostPatterns] as const,
  )
}

async function waitForContent() {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('load')
  await page.waitForTimeout(1500)
  // Trigger lazy-loaded images by scrolling through the page
  await page.evaluate(async () => {
    const totalHeight = document.documentElement.scrollHeight
    const step = Math.max(200, window.innerHeight / 2)
    for (let y = 0; y <= totalHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  // Wait for images to finish loading (with a hard ceiling)
  await page
    .waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll('img'))
        return imgs.every((img) => img.complete && (img.naturalWidth > 0 || img.src === ''))
      },
      { timeout: 10000 },
    )
    .catch(() => {})
  await page.waitForTimeout(500)
}

async function findGenreSlug(): Promise<string | null> {
  await page.goto(`${BASE_URL}/genres`, { waitUntil: 'domcontentloaded' })
  await waitForContent()
  // Genre cards are <button onClick={navigate(...)}>, not anchors.
  const firstCard = page
    .locator('button')
    .filter({ has: page.locator('p.truncate') })
    .first()
  if (!(await firstCard.count().catch(() => 0))) return null
  await firstCard.click()
  await page.waitForURL(/\/genres\//, { timeout: 10000 }).catch(() => {})
  const url = new URL(page.url())
  return url.pathname.startsWith('/genres/') ? url.pathname : null
}

const genreHref = await findGenreSlug()
if (genreHref) {
  const idx = specs.findIndex((p) => p.file === 'genres.png')
  specs.splice(idx + 1, 0, { path: genreHref, file: 'genre-detail.png', theme: 'dark' })
}

for (const spec of specs) {
  if (ONLY && !ONLY.includes(spec.file.replace(/\.png$/, ''))) continue
  console.log(`Capturing ${spec.file}...`)
  await setTheme(spec.theme)
  if (spec.path) {
    try {
      await page.goto(`${BASE_URL}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch (e) {
      console.warn(`  nav warning: ${(e as Error).message}`)
    }
    await waitForContent()
  }
  await setTheme(spec.theme)
  if (spec.onPage) await spec.onPage(page)
  await page.waitForTimeout(300)
  await sanitize()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT_DIR}/${spec.file}`, fullPage: false })
}

await browser.close()
console.log('Done')

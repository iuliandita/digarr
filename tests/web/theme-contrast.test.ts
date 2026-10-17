import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COLOR_THEMES } from '../../src/web/lib/theme'

type Rgb = [number, number, number]

const css = readFileSync('src/web/index.css', 'utf8')
const AA = 4.5

function parseDecls(body: string): Map<string, string> {
  const decls = new Map<string, string>()
  for (const m of body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m
    if (name && value) decls.set(name, value.trim())
  }
  return decls
}

function block(selector: string): string | undefined {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return undefined
  return css.slice(start, css.indexOf('}', start))
}

const defaults = parseDecls(block('@theme') ?? '')

function hexToRgb(hex: string): Rgb {
  const h = hex.slice(1)
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as Rgb
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (c: number) => Math.min(1, Math.max(0, c))
const map3 = (v: Rgb, f: (c: number, i: 0 | 1 | 2) => number): Rgb => [
  f(v[0], 0),
  f(v[1], 1),
  f(v[2], 2),
]

function rgbToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = map3(rgb, toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return map3(linear, (c) => clamp(fromLinear(c)))
}

// color-mix(in oklab, x p%, y) for opaque colors: straight interpolation of L, a, b
function mixOklab(x: Rgb, y: Rgb, p: number): Rgb {
  const lx = rgbToOklab(x)
  const ly = rgbToOklab(y)
  return oklabToRgb(map3(lx, (v, i) => v * p + ly[i] * (1 - p)))
}

// bg-accent/5 is a translucent fill; the browser composites it over the surface in sRGB
const overlay = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  map3(fg, (c, i) => c * alpha + bg[i] * (1 - alpha))

function luminance(rgb: Rgb): number {
  const [r, g, b] = map3(rgb, toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function resolveTheme(id: string): (token: string) => Rgb {
  const themeBlock = block(`[data-theme="${id}"]`)
  if (!themeBlock) throw new Error(`No [data-theme="${id}"] block in index.css`)
  const decls = new Map([...defaults, ...parseDecls(themeBlock)])
  const resolve = (token: string): Rgb => {
    const value = decls.get(token)
    if (!value) throw new Error(`${id}: ${token} is not defined`)
    if (value.startsWith('#')) return hexToRgb(value)
    const ref = value.match(/^var\((--[\w-]+)\)$/)
    if (ref?.[1]) return resolve(ref[1])
    const mix = value.match(/^color-mix\(in oklab, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/)
    if (mix?.[1] && mix[3]) return mixOklab(resolve(mix[1]), resolve(mix[3]), Number(mix[2]) / 100)
    throw new Error(`${id}: cannot resolve ${token}: ${value}`)
  }
  return resolve
}

type Pair = { fg: string; on: string; color: (t: (token: string) => Rgb) => [Rgb, Rgb] }

const pair = (fg: string, on: string): Pair => ({
  fg,
  on,
  color: (t) => [t(`--color-${fg}`), t(`--color-${on}`)],
})

const tint = (fg: string, fill: string, alpha = 5): Pair => ({
  fg,
  on: `${fill}/${alpha} over surface`,
  color: (t) => [
    t(`--color-${fg}`),
    overlay(t(`--color-${fill}`), t('--color-surface'), alpha / 100),
  ],
})

const PAIRS: Pair[] = [
  ...['bg', 'surface', 'surface-2', 'surface-3'].map((on) => pair('text', on)),
  ...['bg', 'surface', 'surface-2'].map((on) => pair('muted', on)),
  pair('accent-fg', 'accent'),
  pair('accent-fg', 'accent-hover'),
  pair('accent-text', 'bg'),
  pair('accent-text', 'surface'),
  tint('accent-text', 'accent'),
  pair('reject', 'surface'),
  tint('reject', 'reject'),
  // destructive buttons: bg-reject text-bg
  pair('bg', 'reject'),
  // filled approve buttons: bg-approve text-bg
  pair('bg', 'approve'),
  // status text; bg-{color}/5..20 tints are the levels used in src/web
  ...['approve', 'info', 'warning'].flatMap((c) => [
    pair(c, 'surface'),
    ...[5, 10, 20].map((a) => tint(c, c, a)),
  ]),
]

const themeIds = COLOR_THEMES.flatMap(({ id }) => [`${id}-dark`, `${id}-light`])

describe('theme contrast', () => {
  it('every theme pair reaches WCAG AA (4.5:1)', () => {
    const failures: string[] = []
    for (const id of themeIds) {
      const t = resolveTheme(id)
      for (const p of PAIRS) {
        const ratio = contrast(...p.color(t))
        if (ratio < AA)
          failures.push(
            `${id.padEnd(18)} ${p.fg.padEnd(12)} on ${p.on.padEnd(22)} ${ratio.toFixed(2)}`,
          )
      }
    }
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([])
  })
})

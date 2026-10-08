#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isStringLiteral,
  type Node,
} from 'typescript/unstable/ast'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { API } from 'typescript/unstable/sync'

export type Finding = { file: string; message: string }

export const INTERNAL_ENV_EXCLUSIONS: Readonly<Record<string, string>> = {
  NODE_ENV: 'Build/runtime mode, not operator configuration.',
  VITEST: 'Test harness marker.',
  DIGARR_DISABLE_RATE_LIMIT: 'Development-only rate-limit override.',
  DIGARR_GIT_SHA: 'Build identity stamped by the image build.',
  DIGARR_CHANNEL: 'Build identity stamped by the image build.',
}

export function trackedFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function safePath(root: string, file: string): string {
  const target = resolve(root, file)
  if (!within(root, target) || (existsSync(target) && !within(root, realpathSync(target)))) {
    throw new Error(`path escapes repository: ${file}`)
  }
  return target
}

export function withoutFences(source: string): string {
  let fence: { char: string; length: number } | undefined
  return source
    .split('\n')
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (fence) {
        if (
          match &&
          match[1]?.[0] === fence.char &&
          match[1].length >= fence.length &&
          !match[2]?.trim()
        )
          fence = undefined
        return ''
      }
      if (match?.[1]) {
        fence = { char: match[1][0] ?? '`', length: match[1].length }
        return ''
      }
      return line
    })
    .join('\n')
}

function plainHeading(text: string): string {
  return text
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/(^|\s)_{1,2}(.+?)_{1,2}(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '')
    .toLowerCase()
    .replace(/ /g, '-')
}

export function markdownAnchors(source: string): Set<string> {
  const clean = withoutFences(source)
  const anchors = new Set<string>()
  const counts = new Map<string, number>()
  const lines = clean.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const atx = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    const heading =
      atx?.[1] ??
      (/^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] ?? '') && line.trim() ? line.trim() : undefined)
    if (heading) {
      const base = plainHeading(heading)
      let count = counts.get(base) ?? 0
      let slug = count ? `${base}-${count}` : base
      while (anchors.has(slug)) {
        count++
        slug = `${base}-${count}`
      }
      counts.set(base, count + 1)
      anchors.add(slug)
    }
  }
  for (const tag of clean.matchAll(/<[^>]+\b(?:id|name)\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    if (tag[2]) anchors.add(tag[2])
  }
  return anchors
}

function destination(text: string): string | undefined {
  const value = text.trim()
  if (value.startsWith('<')) return value.match(/^<([^>]*)>/)?.[1]
  return value.match(/^(\S+?)(?:\s+["'].*)?$/)?.[1]
}

export function markdownTargets(source: string): string[] {
  const clean = withoutFences(source).replace(/(`+)[^\n]*?\1/g, '')
  const references = new Map<string, string>()
  const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
  const body = clean.replace(
    /^ {0,3}\[([^\]]+)\]:[ \t]*(.+)$/gm,
    (_all, label: string, target: string) => {
      const value = destination(target)
      if (value !== undefined) references.set(normalize(label), value)
      return ''
    },
  )
  const targets: string[] = []
  // Scan balanced parentheses so local filenames may contain parentheses.
  const links = /!?\[([^\]\n]*)\](?:\[([^\]\n]*)\]|\()/g
  for (const match of body.matchAll(links)) {
    if (match[0].endsWith('(')) {
      const start = (match.index ?? 0) + match[0].length
      let depth = 1
      let end = start
      for (; end < body.length && depth; end++) {
        if (body[end] === '\\') {
          end++
          continue
        }
        if (body[end] === '(') depth++
        if (body[end] === ')') depth--
      }
      if (!depth) {
        const value = destination(body.slice(start, end - 1))
        if (value !== undefined) targets.push(value)
      }
    } else {
      const value = references.get(normalize(match[2] || match[1] || ''))
      if (value !== undefined) targets.push(value)
    }
  }
  for (const match of body.matchAll(/(?<!!)\[([^\]\n]+)\](?![[(])/g)) {
    const value = references.get(normalize(match[1] ?? ''))
    if (value !== undefined) targets.push(value)
  }
  for (const match of body.matchAll(
    /<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*(["'])(.*?)\1[^>]*>/gi,
  )) {
    if (match[2]) targets.push(match[2])
  }
  return [...new Set(targets)]
}

export function checkMarkdownLinks(rootInput: string, files: readonly string[]): Finding[] {
  const root = realpathSync(rootInput)
  const tracked = new Set(files)
  const findings: Finding[] = []
  const cache = new Map<string, Set<string>>()
  for (const file of files.filter((file) => file.endsWith('.md'))) {
    let source: string
    try {
      source = readFileSync(safePath(root, file), 'utf8')
    } catch (error) {
      findings.push({ file, message: String(error) })
      continue
    }
    for (const target of markdownTargets(source)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue
      try {
        const hash = target.indexOf('#')
        const fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1))
        const rawPath = (hash < 0 ? target : target.slice(0, hash)).split('?')[0] ?? ''
        const decoded = decodeURIComponent(rawPath)
        const local = decoded
          ? resolve(
              decoded.startsWith('/') ? root : dirname(resolve(root, file)),
              decoded.replace(/^\//, ''),
            )
          : resolve(root, file)
        const path = safePath(root, local)
        if (!existsSync(path)) throw new Error('missing local target')
        if (fragment && extname(path).toLowerCase() === '.md') {
          const rel = relative(root, path).split(sep).join('/')
          if (!tracked.has(rel)) throw new Error('Markdown target is not tracked')
          if (!cache.has(path)) cache.set(path, markdownAnchors(readFileSync(path, 'utf8')))
          if (!cache.get(path)?.has(fragment)) throw new Error(`missing anchor #${fragment}`)
        }
      } catch (error) {
        findings.push({
          file,
          message: `${target}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }
  return findings
}

type EnvironmentSource = { file: string; source: string; helpers: boolean }

function extractEnvironmentSources(sources: readonly EnvironmentSource[]): Set<string> {
  if (sources.length === 0) return new Set()
  // The native compiler's synchronous pipe transport requires Node internals.
  if (process.versions.bun) {
    const input = JSON.stringify(sources)
    if (Buffer.byteLength(input) > 32 * 1024 * 1024)
      throw new Error('Environment source input exceeds 32 MiB')
    try {
      return new Set(
        JSON.parse(
          execFileSync('node', [fileURLToPath(import.meta.url), '--environment-ast'], {
            input,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
          }),
        ) as string[],
      )
    } catch (error) {
      throw new Error(
        'Environment AST check requires Node.js 22.18 or newer and the installed TypeScript native binary',
        { cause: error },
      )
    }
  }
  const root = '/docs-content-ast'
  const files: Record<string, string> = Object.fromEntries(
    sources.map(({ file, source }) => [`${root}/${file}`, source]),
  )
  files[`${root}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { noLib: true, noResolve: true, jsx: 'preserve', types: [] },
    files: sources.map(({ file }) => file),
  })
  const virtual = createVirtualFileSystem(files)
  const api = new API({
    cwd: root,
    fs: {
      ...virtual,
      readFile: (file) => files[file] ?? null,
      getAccessibleEntries: (directory) =>
        virtual.getAccessibleEntries?.(directory) ?? { files: [], directories: [] },
    },
  })
  const names = new Set<string>()
  const isEnv = (node: Node): boolean =>
    isPropertyAccessExpression(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  try {
    const snapshot = api.updateSnapshot({ openProjects: [`${root}/tsconfig.json`] })
    try {
      const project = snapshot.getProjects()[0]
      if (!project) throw new Error('TypeScript could not load the documentation source snapshot')
      for (const { file, helpers } of sources) {
        const ast = project.program.getSourceFile(`${root}/${file}`)
        if (!ast) throw new Error(`TypeScript could not parse ${file}`)
        function visit(node: Node): void {
          if (
            helpers &&
            isCallExpression(node) &&
            isIdentifier(node.expression) &&
            /^(env|envOrFile|envBool|envInt|envOneOf)$/.test(node.expression.text)
          ) {
            const argument = node.arguments[0]
            if (argument && isStringLiteral(argument)) {
              names.add(argument.text)
              if (node.expression.text === 'envOrFile') names.add(`${argument.text}_FILE`)
            }
          }
          if (isPropertyAccessExpression(node) && isEnv(node.expression)) names.add(node.name.text)
          if (
            isElementAccessExpression(node) &&
            isEnv(node.expression) &&
            isStringLiteral(node.argumentExpression)
          )
            names.add(node.argumentExpression.text)
          node.forEachChild(visit)
        }
        visit(ast)
      }
    } finally {
      snapshot.dispose()
    }
  } finally {
    api.close()
  }
  return names
}

export function extractEnvironmentNames(source: string, helpers = false): Set<string> {
  return extractEnvironmentSources([{ file: 'source.tsx', source, helpers }])
}

export function isOperatorDoc(file: string): boolean {
  return (
    [
      '.env.example',
      'deploy/docker/.env.example',
      'docs/OPERATIONS.md',
      'docs/AUTHENTICATION.md',
      'docs/ARCHITECTURE.md',
      'docs/runbooks/encryption-key-rotation.md',
    ].includes(file) ||
    /^docs\/guides\/.*\.md$/.test(file) ||
    /^deploy\/.*\/README\.md$/.test(file)
  )
}

export function checkEnvironmentCoverage(root: string, files: readonly string[]): Finding[] {
  const sources: EnvironmentSource[] = []
  const docs: string[] = []
  for (const file of files) {
    const path = safePath(root, file)
    if (!existsSync(path)) continue
    if (/^src\/.*\.tsx?$/.test(file))
      sources.push({
        file,
        source: readFileSync(path, 'utf8'),
        helpers: file === 'src/config/env.ts',
      })
    if (isOperatorDoc(file)) docs.push(readFileSync(path, 'utf8'))
  }
  const names = extractEnvironmentSources(sources)
  const identifiers = new Set(docs.join('\n').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
  return [...names]
    .sort()
    .filter((name) => !Object.hasOwn(INTERNAL_ENV_EXCLUSIONS, name) && !identifiers.has(name))
    .map((name) => ({
      file: 'src/',
      message: `${name} is missing from tracked operator documentation or .env.example`,
    }))
}

export function checkDocsContent(root: string, files = trackedFiles(root)): Finding[] {
  if (!statSync(root).isDirectory()) throw new Error('repository root must be a directory')
  return [
    ...checkMarkdownLinks(root, files),
    ...checkEnvironmentCoverage(realpathSync(root), files),
  ]
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length) {
    console.error('Usage: bun scripts/check-docs-content.ts')
    return 2
  }
  try {
    const findings = checkDocsContent(process.cwd())
    for (const finding of findings) console.error(`${finding.file}: ${finding.message}`)
    if (findings.length) return 1
    console.log('Documentation links and literal environment-name coverage are consistent.')
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  if (process.argv[2] === '--environment-ast' && !process.versions.bun) {
    const sources = JSON.parse(readFileSync(0, 'utf8')) as EnvironmentSource[]
    console.log(JSON.stringify([...extractEnvironmentSources(sources)]))
  } else process.exitCode = main()

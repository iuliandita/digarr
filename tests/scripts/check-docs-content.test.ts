// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkDocsContent,
  checkEnvironmentCoverage,
  checkMarkdownLinks,
  extractEnvironmentNames,
  INTERNAL_ENV_EXCLUSIONS,
  markdownAnchors,
  trackedFiles,
} from '../../scripts/check-docs-content'

const roots: string[] = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'digarr-docs-content-'))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('documentation content checks', () => {
  it('finds broken relative paths and renamed fragments with their source and target', () => {
    const files = {
      'README.md': '[Missing](docs/gone.md) [Renamed](docs/guide.md#old-heading)',
      'docs/guide.md': '# New heading',
    }
    const findings = checkMarkdownLinks(fixture(files), Object.keys(files))
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ file: 'README.md' })
    expect(findings[0]?.message).toContain('docs/gone.md: missing local target')
    expect(findings[1]?.message).toContain('missing anchor #old-heading')
  })

  it('validates encoded paths, duplicate headings, HTML anchors/images, and references', () => {
    const files = {
      'README.md': [
        '[One](docs/a%20guide.md#hello-world-1)',
        '[Two][guide] [guide] [guide][]',
        '[Inline](docs/a%20guide.md#named)',
        '<img src="images/a%20b.png" />',
        '<a href="docs/a%20guide.md#custom">Custom</a>',
        '[guide]: <docs/a%20guide.md#hello-world> "Title"',
        '[Remote](https://example.com/missing) [Mail](mailto:a@example.com)',
        '![Inline data](data:image/png;base64,abc) [Scheme](custom:thing)',
        '![Remote](//example.com/image.png)',
      ].join('\n'),
      'docs/a guide.md':
        '# Hello *World*!\n# Hello `World`!\n<a name="named"></a>\n<div id="custom"></div>',
      'images/a b.png': 'fixture',
    }
    expect(checkMarkdownLinks(fixture(files), Object.keys(files))).toEqual([])
  })

  it('ignores Markdown and HTML samples in backtick and tilde fences', () => {
    const files = {
      'README.md': [
        '```md',
        '[Fake](missing.md) <img src="missing.png">',
        '# Fake',
        '```',
        '~~~~',
        '[Fake][missing]',
        '[missing]: missing.md',
        '~~~~',
        '`[Fake](missing.md)`',
        '# Real',
        '[Real](#real)',
      ].join('\n'),
    }
    expect(checkMarkdownLinks(fixture(files), Object.keys(files))).toEqual([])
    expect(markdownAnchors(files['README.md'])).toEqual(new Set(['real']))
  })

  it('supports setext headings and punctuation without losing heading text', () => {
    expect(
      markdownAnchors('A **bold** [link](guide.md) and `code`!\n===\n# Café & tea\n# A_b'),
    ).toEqual(new Set(['a-bold-link-and-code', 'café--tea', 'a_b']))
  })

  it('refuses traversal, symlink escapes, and untracked Markdown anchor reads', () => {
    const outside = fixture({ 'secret.md': '# Secret' })
    const files = {
      'README.md': '[Escape](../secret.md) [Link](escape.md#secret) [Private](private.md#private)',
    }
    const root = fixture({ ...files, 'private.md': '# Private' })
    symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'))
    const findings = checkMarkdownLinks(root, Object.keys(files))
    expect(findings).toHaveLength(3)
    expect(findings[0]?.message).toContain('path escapes repository')
    expect(findings[1]?.message).toContain('path escapes repository')
    expect(findings[2]?.message).toContain('not tracked')
  })

  it('detects missing HTML image files and missing HTML anchors', () => {
    const files = { 'README.md': '<img src="gone.png">\n[Anchor](#absent)' }
    const findings = checkMarkdownLinks(fixture(files), Object.keys(files))
    expect(findings.map((finding) => finding.message).join('\n')).toContain('gone.png')
    expect(findings.map((finding) => finding.message).join('\n')).toContain(
      'missing anchor #absent',
    )
  })

  it('extracts helper calls, defaults, _FILE names, and literal bracket access without executing source', () => {
    const source = [
      "throw new Error('must never execute')",
      "env('NEW_SETTING') ?? 'default'",
      "envOrFile('DATABASE_URL')",
      "envBool('FEATURE_ENABLED', true)",
      "envInt('POOL_SIZE')",
      "envOneOf('CHOICE', ['a', 'b'])",
      "process.env.DIRECT; process.env['BRACKET']; process.env[dynamic]",
      'env(dynamic); env(`' + '$' + '{key}_FILE`)',
      "// env('COMMENT') process.env.COMMENT",
      '/* process.env.BLOCK_COMMENT */',
      'const example = "process.env.STRING_EXAMPLE"',
    ].join('\n')
    expect([...extractEnvironmentNames(source, true)].sort()).toEqual([
      'BRACKET',
      'CHOICE',
      'DATABASE_URL',
      'DATABASE_URL_FILE',
      'DIRECT',
      'FEATURE_ENABLED',
      'NEW_SETTING',
      'POOL_SIZE',
    ])
    expect([...extractEnvironmentNames(source)].sort()).toEqual(['BRACKET', 'DIRECT'])
  })

  it('requires whole environment identifiers in operator docs and excludes only explicit internal names', () => {
    const source = [
      "envOrFile('PUBLIC_SECRET')",
      ...Object.keys(INTERNAL_ENV_EXCLUSIONS).map((name) => `process.env.${name}`),
      'process.env.NEW_INTERNAL_LOOKING_NAME',
    ].join('\n')
    const files = {
      'src/config/env.ts': source,
      '.env.example': 'PUBLIC_SECRET_FILE=/run/secrets/value\nNOT_PUBLIC_SECRET=example',
      'README.md': 'PUBLIC_SECRET NEW_INTERNAL_LOOKING_NAME',
    }
    const root = fixture(files)
    const findings = checkEnvironmentCoverage(root, Object.keys(files))
    expect(findings.map((finding) => finding.message)).toEqual([
      'NEW_INTERNAL_LOOKING_NAME is missing from tracked operator documentation or .env.example',
      'PUBLIC_SECRET is missing from tracked operator documentation or .env.example',
    ])
    expect(Object.values(INTERNAL_ENV_EXCLUSIONS).every((reason) => reason.length > 10)).toBe(true)
    writeFileSync(
      join(root, '.env.example'),
      'PUBLIC_SECRET=example\nPUBLIC_SECRET_FILE=/run/secrets/value\nNEW_INTERNAL_LOOKING_NAME=yes',
    )
    expect(checkEnvironmentCoverage(root, Object.keys(files))).toEqual([])
  })

  it('checks newly staged docs but does not collect ignored private files', () => {
    const root = fixture({
      '.gitignore': 'private.md',
      'README.md': '# Readme',
      'private.md': '[Ignored](gone.md)',
    })
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    }
    git(['init', '-q'])
    git(['add', 'README.md', '.gitignore'])
    expect(trackedFiles(root)).not.toContain('private.md')
    expect(checkDocsContent(root)).toEqual([])
    writeFileSync(join(root, 'new.md'), '[Missing](gone.md)')
    git(['add', 'new.md'])
    expect(checkDocsContent(root)[0]).toMatchObject({ file: 'new.md' })
  })

  it('passes on the actual tracked repository', () => {
    expect(checkDocsContent(resolve('.'))).toEqual([])
  })

  it('returns exit 2 for invalid CLI arguments', () => {
    const result = spawnSync('bun', [resolve('scripts/check-docs-content.ts'), '--unknown'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })
})

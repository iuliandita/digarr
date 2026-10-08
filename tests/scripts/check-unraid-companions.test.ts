import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const template = (
  repository = 'image:v1.19.0',
  field = '<Config Type="Variable" Target="PORT" Default="3000" Description="Listen port">3000</Config>',
) =>
  `<Container><Name>Digarr</Name><Repository>${repository}</Repository><Branch>stable</Branch><Privileged>false</Privileged>${field}</Container>`

function check(bundled: string, personal: string, community = personal, markdown = false) {
  const directory = mkdtempSync(join(tmpdir(), 'digarr-companion-test-'))
  directories.push(directory)
  const bundledPath = join(directory, 'bundled.xml')
  const personalPath = join(directory, 'personal.xml')
  const communityPath = join(directory, 'community.xml')
  writeFileSync(bundledPath, bundled)
  writeFileSync(personalPath, personal)
  writeFileSync(communityPath, community)
  return spawnSync(
    'python3',
    [
      resolve('scripts/check-unraid-companions.py'),
      '--bundled',
      bundledPath,
      '--personal',
      personalPath,
      '--community',
      communityPath,
      '--format',
      markdown ? 'markdown' : 'json',
    ],
    { encoding: 'utf8' },
  )
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Unraid companion contract comparison', () => {
  it('allows moving image tags and digest comments', () => {
    const result = check(
      template(),
      template('image:latest').replace('</Container>', '<!-- digest: changed --></Container>'),
    )
    expect(result.status).toBe(0)
    expect(
      JSON.parse(result.stdout).companions.map((item: { status: string }) => item.status),
    ).toEqual(['aligned', 'aligned'])
  })

  it.each([
    ['default', template().replace('Default="3000"', 'Default="8080"')],
    ['operator help', template().replace('Listen port', 'Different port help')],
    ['missing field', template().replace(/<Config[^>]*>.*?<\/Config>/, '')],
    ['privilege', template().replace('<Privileged>false', '<Privileged>true')],
  ])('detects changed %s', (_, changed) => {
    const result = check(template(), changed)
    expect(result.status).toBe(changed.includes('<Config') ? 1 : 2)
    const reports = JSON.parse(result.stdout).companions
    expect(reports.every((item: { status: string }) => item.status !== 'aligned')).toBe(true)
  })

  it('reports each repository independently', () => {
    const result = check(template(), template(), template().replace('Listen port', 'Other help'))
    expect(result.status).toBe(1)
    expect(
      JSON.parse(result.stdout).companions.map((item: { status: string }) => item.status),
    ).toEqual(['aligned', 'different'])
  })

  it('rejects invalid XML without calling it aligned', () => {
    const result = check(template(), '<Container>')
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout).companions[0].status).toBe('unavailable')
  })

  it('rejects duplicate configuration keys', () => {
    const result = check(
      template(),
      template().replace(
        '</Container>',
        '<Config Type="Variable" Target="PORT">8080</Config></Container>',
      ),
    )
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout).companions[0].error).toContain('duplicate template field')
  })

  it('fails when the bundled template is invalid', () => {
    const result = check('<Wrong/>', template())
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Bundled template cannot be checked')
  })

  it('classifies an interrupted HTTP response as unavailable, not drift', () => {
    const directory = mkdtempSync(join(tmpdir(), 'digarr-companion-network-test-'))
    directories.push(directory)
    const bundledPath = join(directory, 'bundled.xml')
    writeFileSync(bundledPath, template())
    const program = `import importlib.util, http.client, sys
spec = importlib.util.spec_from_file_location("companion", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def interrupted(url):
    raise http.client.IncompleteRead(b"partial", 100)
module.retrieve = interrupted
sys.argv = [sys.argv[1], "--bundled", sys.argv[2]]
raise SystemExit(module.main())`
    const result = spawnSync(
      'python3',
      ['-c', program, resolve('scripts/check-unraid-companions.py'), bundledPath],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(
      JSON.parse(result.stdout).companions.every(
        (item: { status: string }) => item.status === 'unavailable',
      ),
    ).toBe(true)
  })

  it('renders an advisory report for workflow summaries', () => {
    const result = check(
      template(),
      template().replace('Listen port', 'Other help'),
      template(),
      true,
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Config:Variable:PORT')
    expect(result.stdout).toContain('selfhosters/unRAID-CA-templates')
    expect(result.stdout).toContain('advisory')
  })
})

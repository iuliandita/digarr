import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recommendationQualityFixtures } from '../../scripts/evals/recommendation-quality'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

function validOutput(caseId: string): string {
  const fixture = recommendationQualityFixtures.find((item) => item.id === caseId)
  if (!fixture) throw new Error('Missing test fixture')
  const names = [
    fixture.expectedNeighbors[0] ?? 'Synthetic Artist 0',
    ...Array.from({ length: 14 }, (_, i) => `Synthetic Artist ${i + 1}`),
  ]
  return JSON.stringify(
    names.map((artistName) => ({
      artistName,
      reasoning: 'Synthetic contract test only.',
      confidence: 0.6,
      genres: ['synthetic'],
    })),
  )
}

async function replay(
  runs: Array<{ caseId: string; output: string }>,
  overrides: Record<string, unknown> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'digarr-quality-'))
  temporaryDirectories.push(directory)
  const capture = join(directory, 'capture.json')
  const report = join(directory, 'nested/report.json')
  await writeFile(
    capture,
    JSON.stringify({
      schemaVersion: 1,
      provider: 'synthetic-test',
      model: 'synthetic-test',
      capturedAt: '2026-10-01T08:00:00Z',
      runs,
      ...overrides,
    }),
  )
  const result = spawnSync(
    'bun',
    ['run', 'scripts/recommendation-quality.ts', 'replay', capture, report],
    { cwd: resolve('.'), encoding: 'utf8' },
  )
  if (result.error) throw result.error
  return { result, report }
}

describe('recommendation quality replay CLI', () => {
  it('rejects unrelated capture fields and invalid metadata', async () => {
    const invalidTime = await replay([], { capturedAt: 'not-a-date' })
    expect(invalidTime.result.status).toBe(1)
    const extraField = await replay([], { apiKey: 'should-not-be-captured' })
    expect(extraField.result.status).toBe(1)
  })

  it('writes a complete contract report without calling a provider', async () => {
    const { result, report } = await replay(
      recommendationQualityFixtures.map((fixture) => ({
        caseId: fixture.id,
        output: validOutput(fixture.id),
      })),
    )
    expect(result.status).toBe(0)
    const data = JSON.parse(await readFile(report, 'utf8'))
    expect(data).toMatchObject({
      complete: true,
      passedCases: 14,
      evaluatedCases: 14,
      provenance: 'unverified',
      missingCases: [],
    })
    expect(
      data.runs.every(
        (run: { judgments: { recommendationFit: string } }) =>
          run.judgments.recommendationFit === 'unjudged',
      ),
    ).toBe(true)
    expect(data.promptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails an incomplete capture and reports the missing case IDs', async () => {
    const { result, report } = await replay([
      { caseId: 'art-rock', output: validOutput('art-rock') },
    ])
    expect(result.status).toBe(1)
    const data = JSON.parse(await readFile(report, 'utf8'))
    expect(data).toMatchObject({ complete: false, evaluatedCases: 1, passedCases: 1 })
    expect(data.missingCases).toHaveLength(13)
    expect(data.missingCases).toContain('cold-start')
  })

  it('fails invalid output even when every case was captured', async () => {
    const { result, report } = await replay(
      recommendationQualityFixtures.map((fixture) => ({ caseId: fixture.id, output: '[]' })),
    )
    expect(result.status).toBe(1)
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      complete: true,
      passedCases: 0,
    })
  })

  it('rejects duplicate IDs without replacing an earlier result', async () => {
    const { result } = await replay([
      { caseId: 'art-rock', output: '[]' },
      { caseId: 'art-rock', output: '[]' },
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Duplicate caseId')
  })

  it('rejects unknown case IDs', async () => {
    const { result } = await replay([{ caseId: 'unknown', output: '[]' }])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown caseId')
  })
})

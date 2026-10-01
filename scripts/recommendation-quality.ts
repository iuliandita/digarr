import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { buildRecommendationPrompt } from '../src/core/providers/prompt'
import {
  evaluateRecommendationOutput,
  recommendationQualityFixtures as qualityFixtures,
} from './evals/recommendation-quality'

const root = resolve(import.meta.dirname, '..')
const artifactDir = resolve(root, 'evaluation-results/recommendation-quality')
const captureSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    capturedAt: z.iso.datetime(),
    fixtureHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    promptHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    runs: z
      .array(
        z
          .object({
            caseId: z.string().min(1),
            output: z.string().max(200_000),
            elapsedMs: z.number().nonnegative().optional(),
            usage: z
              .object({
                inputTokens: z.number().int().nonnegative().optional(),
                outputTokens: z.number().int().nonnegative().optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function prepare(): Promise<void> {
  await mkdir(artifactDir, { recursive: true })
  const { build: buildAssertion } = await import('bun')
  const build = await buildAssertion({
    entrypoints: [resolve(root, 'scripts/evals/assert-recommendations.ts')],
    outdir: artifactDir,
    naming: 'assertion.mjs',
    target: 'node',
    format: 'esm',
  })
  if (!build.success) throw new Error(build.logs.map(String).join('\n'))
  const cases = qualityFixtures.map((fixture) => ({
    description: `${fixture.id}: ${fixture.description}`,
    vars: {
      caseId: fixture.id,
      cohort: fixture.cohort,
      recommendationPrompt: buildRecommendationPrompt(fixture.profile),
    },
    assert: [
      {
        type: 'javascript',
        value: 'file://evaluation-results/recommendation-quality/assertion.mjs',
      },
    ],
  }))
  await writeFile(resolve(artifactDir, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`)
  await writeFile(
    resolve(artifactDir, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fixtureHash: fingerprint(qualityFixtures),
        promptHash: fingerprint(cases.map((item) => item.vars.recommendationPrompt)),
        cases: cases.map((item) => ({ id: item.vars.caseId, cohort: item.vars.cohort })),
        note: 'Synthetic evaluation profiles. Neighbor checks are smoke checks, not human taste judgments.',
      },
      null,
      2,
    )}\n`,
  )
  console.log(
    `Prepared ${cases.length} cases in evaluation-results/recommendation-quality. No provider calls made.`,
  )
}

async function replay(inputPath: string, outputPath: string): Promise<boolean> {
  const capture = captureSchema.parse(JSON.parse(await readFile(resolve(inputPath), 'utf8')))
  const seen = new Set<string>()
  const runs = capture.runs.map((run) => {
    if (seen.has(run.caseId)) throw new Error(`Duplicate caseId: ${run.caseId}`)
    seen.add(run.caseId)
    const fixture = qualityFixtures.find((item) => item.id === run.caseId)
    if (!fixture) throw new Error(`Unknown caseId: ${run.caseId}`)
    return { ...run, cohort: fixture.cohort, ...evaluateRecommendationOutput(run.output, fixture) }
  })
  const missingCases = qualityFixtures.filter((item) => !seen.has(item.id)).map((item) => item.id)
  const prompts = qualityFixtures.map((fixture) => buildRecommendationPrompt(fixture.profile))
  const report = {
    schemaVersion: 1,
    provider: capture.provider,
    model: capture.model,
    capturedAt: capture.capturedAt,
    evaluatedAt: new Date().toISOString(),
    fixtureHash: fingerprint(qualityFixtures),
    promptHash: fingerprint(prompts),
    captureFixtureHash: capture.fixtureHash ?? null,
    capturePromptHash: capture.promptHash ?? null,
    provenance:
      !capture.fixtureHash || !capture.promptHash
        ? 'unverified'
        : capture.fixtureHash === fingerprint(qualityFixtures) &&
            capture.promptHash === fingerprint(prompts)
          ? 'matched'
          : 'different',
    complete: missingCases.length === 0,
    missingCases,
    passedCases: runs.filter((run) => run.pass).length,
    evaluatedCases: runs.length,
    runs,
    limitations: [
      'This grades saved output, not provider transport, catalog resolution, ranking, previews, or delivery.',
      'Expected neighbors are advisory plausibility checks. Human recommendation fit remains unjudged.',
      'A prompt hash identifies the current evaluator prompt, not proof the capture used that prompt.',
    ],
  }
  const destination = resolve(outputPath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `${report.passedCases}/${runs.length} cases passed; ${missingCases.length} missing. Report: ${destination}`,
  )
  return report.complete && runs.every((run) => run.pass)
}

async function main(): Promise<void> {
  const [mode, input, output, ...extra] = process.argv.slice(2)
  if (mode === 'prepare' && input === undefined) {
    await prepare()
  } else if (mode === 'replay' && input && extra.length === 0) {
    if (!(await replay(input, output ?? resolve(artifactDir, 'report.json')))) process.exitCode = 1
  } else {
    throw new Error('Usage: bun run eval:quality prepare | replay <capture.json> [report.json]')
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

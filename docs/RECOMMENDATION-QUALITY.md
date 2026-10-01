# Recommendation quality evaluation

Use this baseline before changing recommendation prompts or ranking. It evaluates the production AI prompt using synthetic listening profiles. It does not yet evaluate MusicBrainz resolution, pipeline ranking, previews, or delivery to a music client.

## Prepare without API calls

```sh
bun run eval:quality prepare
```

This generates cases, a bundled assertion, and a manifest in ignored `evaluation-results/recommendation-quality/`. This directory is separate from Playwright output, which browser runs clear. Each case calls the production `buildRecommendationPrompt()` with a structured profile, so prompt changes reach the evaluation automatically. The manifest records fixture and prompt hashes. The fixture data is synthetic, not recorded listening history.

The cases cover familiar mainstream tastes, niche genres, cold starts without history, non-English artist names, ambiguous artist names, several equally weighted musical interests, and sparse mixed-source evidence. Keep fixture IDs stable when comparing runs. Record fixture changes as a new baseline; do not compare different cohorts as if the model alone changed.

## Run a live comparison

The existing `AI Recommendation Evals` workflow is manual and advisory. It prepares cases, runs the pinned Promptfoo version against the configured providers, and retains evaluation evidence for 14 days. It requires the provider secrets named in the workflow. There is no paid judge and no automatic live run on a PR.

To run the same comparison locally:

```sh
bun run eval:quality prepare
npx --yes promptfoo@0.119.0 eval --config promptfooconfig.yaml --output evaluation-results/recommendation-quality/promptfoo.json
```

Provider calls consume tokens. Check the providers in `promptfooconfig.yaml` and supply credentials through environment variables. Keep captures and reports in ignored output directories; do not include API keys, private profiles, or URLs in committed fixtures. Retain the Promptfoo export and manifest together to associate outputs with inputs. Provider API behavior here is a prompt comparison, not a full test of Digarr's provider adapters or structured-output transport.

## Replay saved outputs

A capture uses this format:

```json
{
  "schemaVersion": 1,
  "provider": "recorded-provider",
  "model": "recorded-model",
  "capturedAt": "2026-10-01T08:00:00Z",
  "runs": [
    {
      "caseId": "case-id-from-manifest",
      "output": "[]",
      "elapsedMs": 1200,
      "usage": { "inputTokens": 800, "outputTokens": 2200 }
    }
  ]
}
```

`output` is the raw model response as a string; the empty array above intentionally fails the recommendation-count check. Copy real case IDs from `manifest.json`. Include all cases for a complete baseline. Repeat runs should use separate capture files; duplicate IDs in one capture are rejected. Promptfoo exports have their own schema and cannot be passed directly to replay; extract each result's case ID and response into this format.

Optionally include top-level `fixtureHash` and `promptHash` copied from the manifest associated with the original run. A replay reports provenance as matched, different, or unverified. Hashes identify supplied inputs; they do not prove which prompt a remote model actually received. Preserve the original capture when evaluating it against a newer baseline.

```sh
bun run eval:quality replay evaluation-results/recommendation-quality/capture.json
```

The default report is `evaluation-results/recommendation-quality/report.json`. An optional final argument selects another report path. Replay makes no provider calls. It returns a nonzero exit code for failed checks, missing cases, malformed captures, duplicate IDs, or unknown case IDs. Partial runs still produce a report showing their missing cases.

## What the checks mean

- Response shape, individual field bounds, and 15-20 returned artists match the production prompt contract. Fenced JSON and reasoning blocks are accepted; other surrounding prose is rejected even if the production parser could salvage an array from it. Invalid rows are counted, even though the production parser can discard them.
- Duplicate names and seed artists are checked with Unicode normalization, case folding, and whitespace normalization. Similar names, accents, and recording identities are not treated as equivalent.
- Expected-neighbor hits use returned `artistName` fields, never explanation text. These are broad plausibility smoke checks, not exhaustive correct answers. Cold-start, eclectic, and sparse-history cases have no expected-neighbor check. For eclectic profiles, human review must assess each distinct interest; one familiar neighbor does not establish broad fit.
- Returned, valid, duplicate, seed-leak, and neighbor-hit counts are separate metrics. A high confidence value is a model assertion, not evidence of accuracy.

A passing run establishes these contracts only. A failing neighbor check can still contain useful discoveries and needs inspection. Non-English-name cases do not automatically prove the reasoning is correctly translated. Ambiguous-name cases do not establish catalog identity resolution. Neither a score nor a known neighbor establishes that a listener will enjoy the output.

## Listening-input checks

The synthetic prompt fixtures start with prepared profiles and bypass source analysis. Separately run `bun run test tests/core/pipeline/analyze.test.ts tests/core/plugins/spotify.test.ts tests/core/plugins/subsonic.test.ts` to check source-relative evidence. Equivalent within-source ordering should survive unit rescaling, repeated source rows, and repeated source results. Distinct known artist identities must remain distinct, and missing genres must not become negative feedback. A changed listening snapshot should change the profile without summing earlier windows.

Profiles may include a bounded `tasteWeight` and a `preferenceBasis` of `rank`, `membership`, or `source-weight`. Keep raw source values separate. Source normalization preserves relative evidence, not measured affinity: a short source list can assign one artist a strong weight, and seed limits can omit interests. These checks do not establish recommendation fit, playback, or delivery.

## Human and end-to-end review

The report leaves recommendation fit unjudged and preview/delivery unmeasured. For each case, separately record whether the artist exists and is correctly described, whether the output fits the stated taste, whether it adds useful unfamiliar music, and whether a preview or exported track is usable. Keep identity mistakes separate from taste disagreements.

Compare runs using the same fixture version, prompt, provider/model, and evaluation settings. Preserve raw outputs and token/latency metadata when available. Use repeated runs to distinguish a consistent regression from sampling variation. Do not set an improvement target until a real baseline is observed, or present synthetic regression tests as measured user satisfaction.

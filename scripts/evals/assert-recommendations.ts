import {
  evaluateRecommendationOutput,
  recommendationQualityFixtures,
} from './recommendation-quality'

export default function assertRecommendations(
  output: string,
  context: { vars: { caseId: string } },
) {
  const fixture = recommendationQualityFixtures.find(({ id }) => id === context?.vars?.caseId)
  if (!fixture)
    return { pass: false, score: 0, reason: 'Unknown recommendation quality fixture ID' }
  const result = evaluateRecommendationOutput(output, fixture)
  return {
    pass: result.pass,
    score: result.pass ? 1 : 0,
    reason:
      result.issues.join('; ') || 'Recommendation contract and advisory neighbor checks passed',
  }
}

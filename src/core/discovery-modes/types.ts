import type { DiscoveryModeRequest } from './request'

export type DiscoveryFieldType = 'text' | 'number' | 'select' | 'multiselect' | 'toggle'

export type DiscoveryConfigField = {
  key: string
  label: string
  type: DiscoveryFieldType
  required?: boolean
  helpText?: string
  options?: Array<{ value: string; label: string }>
}

export type DiscoveryAvailabilityKind = 'strict' | 'fallback'

export type DiscoveryCandidate = {
  candidateType: 'artist' | 'release'
  name: string
  artistName?: string
  mbid?: string
  sourceUrl?: string
  provenanceMode: string
  provenanceProvider: string
  confidenceHint?: number
  explanationHint?: string
  fallbackUsed: boolean
  freshnessDate?: string
}

export type DiscoveryExecutionResult = {
  candidates: DiscoveryCandidate[]
}

export type DiscoveryModeDefinition = {
  id: string
  label: string
  description: string
  availability: DiscoveryAvailabilityKind
  easyFields: DiscoveryConfigField[]
  advancedFields: DiscoveryConfigField[]
  executor: (request: DiscoveryModeRequest) => Promise<DiscoveryExecutionResult>
}

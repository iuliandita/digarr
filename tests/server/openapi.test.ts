// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openapiDoc } from '@/server/helpers/openapi-doc'

describe('OpenAPI skeleton', () => {
  it('declares a valid 3.1 document shape', () => {
    expect(openapiDoc.openapi).toBe('3.1.0')
    expect(openapiDoc.info?.title).toBe('digarr API')
    expect(typeof openapiDoc.info?.version).toBe('string')
  })

  it('declares session cookie and bearer security schemes', () => {
    const schemes = openapiDoc.components?.securitySchemes
    expect(schemes?.sessionCookie?.type).toBe('apiKey')
    expect(schemes?.bearerToken?.scheme).toBe('bearer')
  })

  it('declares the Problem and ValidationError schemas', () => {
    const schemas = openapiDoc.components?.schemas
    expect(schemas?.Problem?.required).toContain('status')
    expect(schemas?.ValidationError?.required).toContain('code')
  })

  it('declares the standard response envelopes', () => {
    const responses = openapiDoc.components?.responses
    for (const key of [
      'Unauthenticated',
      'Forbidden',
      'NotFound',
      'ValidationFailed',
      'RateLimited',
    ]) {
      expect(responses?.[key as keyof typeof responses]).toBeDefined()
    }
  })
})

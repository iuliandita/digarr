import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export type SlskdSearchResult = {
  id: string
  filename: string
  username: string
  size: number
  bitrate?: number
  extension?: string
}

export type SlskdDownload = {
  id: string
  username: string
  state: string
  directory?: string
  filename?: string
}

export function createSlskdClient(url: string, apiKey: string, skipTlsVerify = false) {
  const http = createHttpClient({
    baseUrl: url,
    headers: { 'X-API-KEY': apiKey },
    skipTlsVerify,
  })

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const application = await http.get<Record<string, unknown>>('/api/v0/application')
      const version = typeof application.version === 'string' ? application.version : undefined

      return {
        success: true,
        message: version ? `Connected to slskd v${version}` : 'Connected to slskd',
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  function createSearch(queryText: string): Promise<Record<string, unknown>> {
    return http.post('/api/v0/searches', { queryText })
  }

  function getSearchResults(searchId: string): Promise<SlskdSearchResult[]> {
    return http.get(`/api/v0/searches/${searchId}/results`)
  }

  function enqueueResult(searchId: string, resultId: string): Promise<Record<string, unknown>> {
    return http.post(`/api/v0/searches/${searchId}/results/${resultId}/download`)
  }

  function getDownloads(): Promise<SlskdDownload[]> {
    return http.get('/api/v0/transfers/downloads')
  }

  return {
    testConnection,
    createSearch,
    getSearchResults,
    enqueueResult,
    getDownloads,
  }
}

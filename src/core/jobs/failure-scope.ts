export type FailureScope = 'integration' | 'item'

const ITEM_PATTERN =
  /not configured|requires user context|already exists|not found|validation|(?:quality|metadata) profile|root folder|invalid (?:quality|metadata|root)|no releases were queued|blocked|does not support|did not return/i
const INTEGRATION_PATTERN =
  /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|fetch failed|unable to connect|connection (?:refused|reset)|unauthorized|forbidden|invalid api key|rate limit/i

// The error text is the only signal at record time. Outage = unreachable, timeout, auth, HTTP 5xx/408/429;
// item = missing config, not found, profile rejection, duplicates, blocks, other 4xx. Unknown text stays unclassified.
export function classifyFailure(error: string): FailureScope | undefined {
  const status = Number(/(?:HTTP|status(?: code)?|returned)\s*[:=]?\s*(\d{3})\b/i.exec(error)?.[1])
  if (status) {
    return status >= 500 || [401, 403, 408, 429].includes(status) ? 'integration' : 'item'
  }
  if (ITEM_PATTERN.test(error)) return 'item'
  return INTEGRATION_PATTERN.test(error) ? 'integration' : undefined
}

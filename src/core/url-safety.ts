import { lookup } from 'node:dns/promises'
import {
  getLookupHostname,
  isCloudMetadata,
  isHttpUrl,
  isPrivateIp,
  isPrivateUrl,
  normalizeIp,
} from '@/core/validation'

export type UrlValidation = { ok: true } | { ok: false; message: string }

const CLOUD_METADATA_IPS = new Set(['169.254.169.254', 'fd00:ec2::254'])

export async function validatePublicServiceUrl(url: string, label: string): Promise<UrlValidation> {
  if (!isHttpUrl(url)) {
    return { ok: false, message: `${label} must start with http:// or https://` }
  }
  if (isCloudMetadata(url)) {
    return { ok: false, message: 'Cloud metadata endpoints are not allowed' }
  }
  if (isPrivateUrl(url)) {
    return { ok: false, message: `${label} must not point to a private or internal address` }
  }

  try {
    const { address } = await lookup(getLookupHostname(url))
    if (isPrivateIp(address)) {
      return { ok: false, message: `${label} resolves to a private/internal IP` }
    }
  } catch {
    return { ok: false, message: `Could not resolve ${label.toLowerCase()} hostname` }
  }

  return { ok: true }
}

// Looser variant for AI provider baseUrls that legitimately point at a local
// service (Ollama on localhost, LocalAI on a LAN box). We still block cloud
// metadata endpoints by hostname and by resolved IP so a malicious admin
// cannot exfiltrate API keys through 169.254.169.254 even when "local"
// addresses are otherwise permitted.
export async function validateAiBaseUrl(
  url: string,
  provider: string,
  label: string,
): Promise<UrlValidation> {
  if (!url) return { ok: true }
  if (!isHttpUrl(url)) {
    return { ok: false, message: `${label} must start with http:// or https://` }
  }
  if (isCloudMetadata(url)) {
    return { ok: false, message: 'Cloud metadata endpoints are not allowed' }
  }

  const isLocalProvider = provider === 'ollama' || provider === 'openai-compatible'
  if (!isLocalProvider) {
    return validatePublicServiceUrl(url, label)
  }

  try {
    const { address } = await lookup(getLookupHostname(url))
    if (CLOUD_METADATA_IPS.has(normalizeIp(address))) {
      return { ok: false, message: `${label} resolves to a cloud metadata IP` }
    }
  } catch {
    return { ok: false, message: `Could not resolve ${label.toLowerCase()} hostname` }
  }

  return { ok: true }
}

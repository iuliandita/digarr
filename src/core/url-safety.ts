import { lookup } from 'node:dns/promises'
import { isCloudMetadata, isHttpUrl, isPrivateIp, isPrivateUrl } from '@/core/validation'

export type UrlValidation = { ok: true } | { ok: false; message: string }

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
    const { address } = await lookup(new URL(url).hostname)
    if (isPrivateIp(address)) {
      return { ok: false, message: `${label} resolves to a private/internal IP` }
    }
  } catch {
    return { ok: false, message: `Could not resolve ${label.toLowerCase()} hostname` }
  }

  return { ok: true }
}

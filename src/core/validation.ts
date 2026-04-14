import { lookup } from 'node:dns/promises'
import { isPrivateIp, isPrivateUrl } from '@/core/notifications'

export function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isCloudMetadata(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === '169.254.169.254' || hostname === 'metadata.google.internal'
  } catch {
    return false
  }
}

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

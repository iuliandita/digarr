import { createHash, randomBytes } from 'node:crypto'

export type SubsonicEnvelope<T> = {
  'subsonic-response'?: {
    status: string
    version?: string
    type?: string
    error?: { code: number; message: string }
  } & T
}

type SubsonicAuthOptions = {
  username: string
  password: string
  salt?: string
  extra?: Record<string, string>
}

export function buildSubsonicAuthParams({
  username,
  password,
  salt = randomBytes(8).toString('hex'),
  extra,
}: SubsonicAuthOptions): URLSearchParams {
  // The protocol mandates MD5 for token auth; this is not password storage.
  const token = createHash('md5') // lgtm[js/insufficient-password-hash]
    .update(password + salt)
    .digest('hex')

  return new URLSearchParams({
    u: username,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'digarr',
    f: 'json',
    ...extra,
  })
}

export function unwrapSubsonicResponse<T>(
  response: SubsonicEnvelope<T>,
  fallbackMessage?: string,
): NonNullable<SubsonicEnvelope<T>['subsonic-response']> {
  const body = response?.['subsonic-response']
  if (!body || typeof body.status !== 'string') {
    throw new Error('Malformed Subsonic response (missing subsonic-response envelope)')
  }
  if (body.status !== 'ok') {
    throw new Error(
      body.error?.message ??
        fallbackMessage ??
        `Subsonic error code ${body.error?.code ?? 'unknown'}`,
    )
  }
  return body
}

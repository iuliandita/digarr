# Authentication

Digarr supports four authentication modes. Most deployments only need one.

## Session auth (default)

The password is hashed at rest with scrypt (`node:crypto`). The web UI
requests cookie mode when it registers or signs in, so the server returns an
`HttpOnly; SameSite=Lax; Path=/` `digarr_session` cookie and does not expose the
session token to JavaScript. The cookie is `Secure` when the public URL uses
HTTPS. Session tokens expire after 30 days and are SHA-256 hashed before
storage.

Bearer sessions remain supported for API clients. Calling
`POST /api/v1/auth/login` or `POST /api/v1/auth/register` without
`X-Digarr-Auth-Mode: cookie` returns the token in the JSON response; send it as
`Authorization: Bearer <token>` on later requests. Only pipeline SSE and the
preview-audio proxy also accept `?token=<token>`, for clients that cannot set a
header. A supplied `Authorization` header takes precedence over a cookie, even
when the header is malformed or invalid.

On the first page load after upgrading, the web UI attempts to rotate an active
per-user bearer session previously stored in `localStorage` into a new cookie
session, then removes the stored token. The old bearer is invalidated as part
of the same operation. The deprecated shared `DIGARR_AUTH_TOKEN` cannot be
migrated; affected users must sign in normally. Obsolete `#oidc_token` URL
fragments are removed but never imported.

Logout (`POST /api/v1/auth/logout`) deletes the session server-side (by both
the bearer and cookie token, if present) and clears the `digarr_session`
cookie by emitting `Set-Cookie ... Max-Age=0; Path=/`, so a stale browser
cookie cannot be replayed after sign-out.

### CSRF protection

State-changing `/api/v1/*` requests authenticated by a session cookie or proxy
auth must include `X-Digarr-CSRF: 1` and exact same-origin browser evidence
from `Origin`, `Referer`, or `Sec-Fetch-Site`. The bundled web UI sends this
header automatically. Browser-shaped public mutations, including login and
registration, use the same check. Verified bearer requests do not rely on
ambient browser credentials and remain exempt, so existing API clients do not
need the CSRF header.

Custom browser clients should send requests with credentials enabled and add
`X-Digarr-CSRF: 1` to every `POST`, `PUT`, `PATCH`, or `DELETE`. Unsafe requests
authenticated through a query parameter are rejected.

### Public origin and reverse proxies

Set `ALLOWED_ORIGIN` to the exact public origin that serves Digarr whenever a
reverse proxy, ingress, or TLS terminator changes the scheme or host seen by
the application. Use only the scheme, host, and optional port, with no path or
trailing slash, for example `https://digarr.example.com`.

The value is the CORS allowlist and the trusted origin for CSRF checks. Its
scheme also determines whether the session cookie is `Secure`, and OIDC uses
it to build the callback URL. An incorrect value can make browser login appear
to succeed while the browser rejects the cookie or later mutations return
`403`.

Registration is closed by default after the first user has been created. To
open registration in a fresh install or internal deployment, set
`DIGARR_DISABLE_REGISTRATION=false`.

## OIDC (optional)

Enable OIDC by setting:

- `OIDC_ISSUER_URL` - the IdP discovery URL
- `OIDC_CLIENT_ID` - registered client id
- `OIDC_CLIENT_SECRET` - registered client secret
- `ALLOWED_ORIGIN` - required, used to build the redirect URI

Users click "Sign in with OIDC" on the login screen, redirect to the IdP, and
come back to `/api/v1/auth/oidc/callback`. After a successful callback, Digarr
sets the same `HttpOnly` session cookie as password login and redirects to `/`;
no session token is placed in the URL. Failures still redirect with a stable
`#oidc_error` code so provider-sourced detail does not enter the frontend URL,
server logs, or Referer headers.

After validating the authorization response, Digarr retains only the identity
claims needed for the local account. Provider access, refresh, and ID tokens
are not retained or refreshed, copied between database backends, or written to
backups. OAuth tokens stored for separate provider connections such as Spotify
or Deezer are unrelated to the OIDC callback session token.

### OIDC account matching

OIDC sign-ins are matched to local accounts by the issuer-scoped subject
(`oidcSubject`) only. The matching order is:

1. Match by stored `oidcSubject` (issuer-scoped id; the only safe key).
2. Fall through and auto-create a new local user (the OIDC-provided email is
   stored on the new account).

Digarr deliberately does **not** auto-link an OIDC identity to an existing
local account by matching the `email` claim. A local account's email can be
self-asserted (set under **Settings -> Account -> Email**) and is not verified
by Digarr, so matching on it would let an attacker pre-seed an account with a
victim's address and have the victim's first OIDC sign-in bind to it (pre-link
account takeover).

To link an OIDC identity to an existing local account, set that account's
`oidcSubject` to the value the IdP sends as `sub`. A logged-in self-service
linking flow is the planned long-term replacement.

### OIDC preferred_username sanitization

IdPs may return arbitrary strings in the `preferred_username` claim. Digarr
sanitizes the value before using it as the local username by:

- Stripping every character outside `[A-Za-z0-9._-]`.
- Capping length at 50 characters.
- Falling back to `oidc-<first 8 chars of sub>` when sanitization emptied
  the value.

This protects downstream systems (filesystem paths, SQL identifiers, UI
rendering) from injection via IdP-supplied strings.

### OIDC callback error handling

The callback returns stable, short error codes in the URL fragment rather
than echoing IdP-sourced error messages into the frontend URL. The server log
records a generic callback failure without provider-sourced detail.

Current codes:

| Code          | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `config`      | Server misconfiguration (e.g., `ALLOWED_ORIGIN` not set).     |
| `oidc_failed` | Callback processing threw (bad state, token exchange error).  |

## Proxy auth (optional)

For environments where a reverse proxy (Authelia, Traefik, NGINX +
oauth2-proxy) already authenticates users, Digarr trusts the
`X-Forwarded-User` header when the direct TCP peer IP matches a CIDR in
`PROXY_AUTH_TRUSTED_PROXIES`. Successful proxy auth uses the same cookie and
CSRF policy as password login.

Set:

- `PROXY_AUTH_ENABLED=true`
- `PROXY_AUTH_TRUSTED_PROXIES=10.0.0.0/8,192.168.0.0/16,fd00::/8`
  (comma-separated IPv4 or IPv6 CIDRs; unbounded ranges like `0.0.0.0/0`
  are rejected at boot)

IPv6 CIDRs are supported, and IPv4-mapped IPv6 client addresses are normalized
to IPv4 before matching.

The CIDR parser validates strictly. Misconfigured entries crash boot with a
clear error rather than silently widening trust. Use tight ranges that match
your actual reverse-proxy network.

## Legacy token auth (deprecated)

`DIGARR_AUTH_TOKEN` grants read-only access as `userId=1` with no admin
rights. Retained for backwards compatibility with older deployments; it
will be removed in a future release. Migrate to session auth or OIDC.

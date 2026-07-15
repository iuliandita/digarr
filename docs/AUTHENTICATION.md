# Authentication

Digarr supports four authentication modes. Most deployments only need one.

## Session auth (default)

Username + password hashed at rest with scrypt (`node:crypto`). Successful
login returns a session token delivered as both an `httpOnly; SameSite=Lax`
cookie and an `Authorization: Bearer` token for SPA fetches. Tokens are
SHA-256 hashed before storage.

Logout (`POST /api/v1/auth/logout`) deletes the session server-side (by both
the bearer and cookie token, if present) and clears the `digarr_session`
cookie by emitting `Set-Cookie ... Max-Age=0; Path=/`, so a stale browser
cookie cannot be replayed after sign-out.

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
come back to `/api/v1/auth/oidc/callback`. The callback uses URL fragments for
token and error payloads so they never leak into server logs or Referer
headers.

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
than echoing IdP-sourced error messages into the frontend URL. Verbose
detail is written to the server log (`[oidc] callback failed: ...`).

Current codes:

| Code          | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `config`      | Server misconfiguration (e.g., `ALLOWED_ORIGIN` not set).     |
| `oidc_failed` | Callback processing threw (bad state, token exchange error).  |

## Proxy auth (optional)

For environments where a reverse proxy (Authelia, Traefik, NGINX +
oauth2-proxy) already authenticates users, Digarr trusts the
`X-Forwarded-User` header when the direct TCP peer IP matches a CIDR in
`PROXY_AUTH_TRUSTED_PROXIES`.

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

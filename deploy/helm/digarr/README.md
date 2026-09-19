# digarr Helm Chart

Run Digarr on Kubernetes with embedded PGlite, bundled PostgreSQL, or an existing PostgreSQL database.

## Prerequisites

- Kubernetes `>= 1.29`
- Helm `>= 3.14`
- Persistent storage for the selected backend. PostgreSQL is bundled by default. For an external database, set `postgresql.enabled=false` and supply `database.existingSecret` or the database connection values. Setting `database.host` alone does not disable the bundled server.

## Install

Create a values file and store database credentials in a Kubernetes Secret. This example uses an existing PostgreSQL database and TLS Ingress; replace the host, ingress class, and Secret names for your cluster:

```yaml
postgresql:
  enabled: false
database:
  existingSecret: digarr-database  # Secret key: DATABASE_URL
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: digarr.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: digarr-tls
      hosts:
        - digarr.example.com
backups:
  persistence:
    enabled: true
extraEnv:
  - name: ALLOWED_ORIGIN
    value: https://digarr.example.com
  - name: DIGARR_ENCRYPTION_KEY
    valueFrom:
      secretKeyRef:
        name: digarr-secrets
        key: encryption-key
```

Save this as `my-values.yaml`, review the [network policy](#network-access), then install from a checkout:

```sh
helm install digarr deploy/helm/digarr \
  --namespace arr --create-namespace -f my-values.yaml
```

For bundled PostgreSQL, leave `postgresql.enabled=true`, omit `database.existingSecret`, and set `postgresql.auth.password` in a protected values file. Keep passwords out of command-line arguments.

For embedded PGlite, set `database.backend=pglite`. This skips the bundled PostgreSQL and uses a data PVC by default. Keep `database.pglite.persistence.enabled=true` and `replicaCount=1`. Allow at least 768Mi memory for the app, as the database shares the process memory; larger libraries may need more. Keep backup persistence enabled too.

## Key values

| Value | Default | Purpose |
|-------|---------|---------|
| `replicaCount` | `1` | App pods. Keep at 1; external Postgres alone does not make Digarr safe for multiple replicas. |
| `image.tag` | release version in values.yaml | Used when no digest is set. Update `image.digest` as well when choosing another image. |
| `image.digest` | set by CI | Immutable digest pinning. |
| `ingress.enabled` | `false` | Classic Ingress resource. |
| `ingress.controllerNamespace` | `ingress-nginx` | NetworkPolicy source namespace. |
| `gateway.enabled` | `false` | Gateway API HTTPRoute instead of Ingress. |
| `database.backend` | `postgres` | `postgres` or embedded `pglite`. |
| `postgresql.enabled` | `true` | Bundled PostgreSQL; ignored with `pglite`. |
| `postgresql.auth.password` | _unset_ | **Required** for the bundled PostgreSQL backend. |
| `database.existingSecret` | _unset_ | Reference a pre-created Secret with `DATABASE_URL`. |
| `backups.persistence.enabled` | `false` | PVC-backed `/app/backups` instead of emptyDir. |
| `extraEnv` | `[]` | Extra env vars (e.g. `DIGARR_ENCRYPTION_KEY`). |
| `extraEnvFrom` | `[]` | Extra envFrom entries (e.g. whole OIDC secret). |
| `namespace.create` | `false` | Emit a Namespace with PSA `restricted` enforced. |
| `networkPolicy.enabled` | `true` | NetworkPolicy restricting ingress and egress; see Network access below. |

See `values.yaml` for the full surface.

Ingress and Gateway deployments should inject `ALLOWED_ORIGIN` through
`extraEnv`, set to the exact public `https://` origin, for example
`https://digarr.example.com`. Browser session cookies, CSRF checks, and OIDC
callbacks use that value. Production cookies stay `Secure` even though the
ingress reaches the pod over HTTP, so an HTTPS public origin needs no further
flag. See
[Authentication](../../../docs/AUTHENTICATION.md#public-origin-and-reverse-proxies).

The chart does not expose a dedicated value for `DIGARR_ALLOW_INSECURE_COOKIES`.
A cluster serving Digarr over plain HTTP (no TLS) can opt in through `extraEnv`,
paired with a matching `http://` `ALLOWED_ORIGIN`, accepting that direct HTTP
exposes the session cookie to network interception:

```yaml
extraEnv:
  - name: DIGARR_ALLOW_INSECURE_COOKIES
    value: "true"
```

Digarr currently relies on process-local pipeline coordination, schedulers,
rate limits, and migration locks. External PostgreSQL is useful for managed
storage and larger installations, but it is not sufficient for horizontal app
scaling; keep `replicaCount: 1` until distributed coordination is implemented.

## Network access

The default NetworkPolicy allows inbound traffic from `ingress.controllerNamespace`, DNS, the chart-labeled database pods on port 5432, and HTTP/HTTPS on ports 80 and 443 except for IPv4 RFC1918 ranges, `169.254.0.0/16`, and IPv6 `fd00::/8`. It does not automatically allow an external database, Lidarr, local AI, or a media server on a private network or another port. Add a separate NetworkPolicy with the required destinations and ports before connecting those services. Gateway deployments must also allow their controller namespace. Disabling `networkPolicy.enabled` removes the chart's restrictions; do that only if another policy provides the intended controls.

## Secrets

`DIGARR_ENCRYPTION_KEY`, OIDC client secrets, and similar should be injected
through `extraEnv` or `extraEnvFrom` rather than literal values. Example:

```yaml
extraEnv:
  - name: DIGARR_ENCRYPTION_KEY
    valueFrom:
      secretKeyRef:
        name: my-digarr-secret
        key: encryption-key
```

## Upgrade

```sh
helm upgrade digarr deploy/helm/digarr -n arr -f my-values.yaml
```

The pod template carries `checksum/config` and `checksum/sensitive-config` annotations,
so ConfigMap or Secret changes trigger a rolling restart even when the image
tag is unchanged.

## Rollback

A Helm rollback restores Kubernetes resources, not the database schema. Do not run an older image against an already-migrated database unless its compatibility is established. Restore a compatible backup into a separate database when a schema downgrade is required; see [backup and restore](../../../README.md#backup--restore).

PostgreSQL deployments use a rolling update with `maxUnavailable: 0` and `maxSurge: 1`. PGlite uses `Recreate`, so updates have downtime. The app marks `/health` as draining before shutdown, but that does not guarantee uninterrupted traffic through every proxy.

Backups use `emptyDir` unless `backups.persistence.enabled=true`. An `emptyDir` is lost when a pod is replaced, including during an upgrade. Keep persistent backups and a separate off-cluster copy.

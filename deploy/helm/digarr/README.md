# digarr Helm Chart

Helm chart for deploying the digarr music-discovery pipeline to Kubernetes.

## Prerequisites

- Kubernetes `>= 1.29`
- Helm `>= 3.14`
- A Postgres database. The chart ships a single-replica Postgres StatefulSet
  out of the box; point `database.host` at an external cluster to disable it.

## Install

```sh
helm install digarr deploy/helm/digarr \
  --namespace arr --create-namespace \
  --set postgresql.auth.password='CHANGE_ME' \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=digarr.example.com
```

For non-trivial installs, copy `values.yaml` to `my-values.yaml`, edit, and
install with `-f my-values.yaml`.

## Key values

| Value | Default | Purpose |
|-------|---------|---------|
| `replicaCount` | `1` | App pods. Keep at 1 unless you run external Postgres. |
| `image.tag` | chart appVersion | Pin a specific release. |
| `image.digest` | set by CI | Immutable digest pinning. |
| `ingress.enabled` | `false` | Classic Ingress resource. |
| `ingress.controllerNamespace` | `ingress-nginx` | NetworkPolicy source namespace. |
| `gateway.enabled` | `false` | Gateway API HTTPRoute instead of Ingress. |
| `postgresql.enabled` | `true` | Bundled Postgres StatefulSet. |
| `postgresql.auth.password` | _unset_ | **Required** when `postgresql.enabled=true`. |
| `database.existingSecret` | _unset_ | Reference a pre-created Secret with `DATABASE_URL`. |
| `backups.persistence.enabled` | `false` | PVC-backed `/app/backups` instead of emptyDir. |
| `extraEnv` | `[]` | Extra env vars (e.g. `DIGARR_ENCRYPTION_KEY`). |
| `extraEnvFrom` | `[]` | Extra envFrom entries (e.g. whole OIDC secret). |
| `namespace.create` | `false` | Emit a Namespace with PSA `restricted` enforced. |
| `networkPolicy.enabled` | `true` | NetworkPolicy locking egress to public internet and in-ns Postgres. |

See `values.yaml` for the full surface.

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

The pod template carries `checksum/config` and `checksum/secret` annotations,
so ConfigMap or Secret changes trigger a rolling restart even when the image
tag is unchanged.

## Rollback

```sh
helm rollback digarr -n arr
```

The deployment uses `strategy.rollingUpdate.maxUnavailable: 0` with
`maxSurge: 1`, so the new pod becomes Ready before the old one terminates.
On shutdown, the app flips `/health` to `503 draining` for ~12s before
closing sockets, so rolling updates do not emit 502s.

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Digarr, please report it privately. **Do not open a public issue.**

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in [private vulnerability reporting](https://github.com/iuliandita/digarr/security/advisories/new) to submit a report. This keeps the details confidential until a fix is available.

### Alternative: Direct Contact

Reach out to [@iuliandita](https://github.com/iuliandita) via GitHub.

## What to Expect

- Acknowledgment within 48 hours
- Status update within 7 days
- Fix and disclosure coordinated with you before any public announcement

## Scope

This policy covers the Digarr application code, Docker images, Compose files, Helm charts, raw Kubernetes manifests, and the Unraid template in this repository. It does not cover third-party services Digarr integrates with (Lidarr, Spotify, Deezer, MusicBrainz, etc.).

## Supported Versions

Only the latest release is supported with security fixes. We recommend always running the most recent version.

## Deployment hardening

Use HTTPS and configure the matching public `ALLOWED_ORIGIN`; keep insecure cookies disabled for HTTPS deployments. See [public origin and reverse proxies](docs/AUTHENTICATION.md#public-origin-and-reverse-proxies). Set and retain `DIGARR_ENCRYPTION_KEY` before saving service credentials, and back up the key separately; see [deployment secrets](deploy/docker/README.md#secrets). Restrict network access until the first admin account exists.

The `latest` image channel follows the newest release. The seven-day `stable` channel and pinned versions can lag behind security fixes; see [image channels](deploy/docker/README.md#image-channels). For Debian image advisories, assess the exact release digest and current scanner results against upstream Debian advisories; this policy does not establish that a particular image is free of vulnerabilities.

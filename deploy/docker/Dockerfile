# syntax=docker/dockerfile:1.7

# Global ARG -- must be before any FROM. Alpine default: fewer OS-package CVEs
# than slim. Override to the slim digest for the -debian variant.
ARG RUNTIME_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

# Deps stage -- all deps (dev + prod) for the builder. Cache-mount accelerates rebuilds.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile

# Build stage -- reuses deps, produces dist/.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DIGARR_GIT_SHA=dev
ARG DIGARR_CHANNEL=local
ENV DIGARR_GIT_SHA=${DIGARR_GIT_SHA}
ENV DIGARR_CHANNEL=${DIGARR_CHANNEL}
ENV NODE_ENV=production
RUN bun run build

# Deps-prod stage -- production-only deps, shared cache id.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS deps-prod
WORKDIR /app
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --production

# Runtime stage -- defaults to alpine; override RUNTIME_IMAGE for the slim/debian variant.
# checkov:skip=CKV_DOCKER_7: Default and release override runtime images are version-and-digest pinned.
FROM ${RUNTIME_IMAGE}

LABEL org.opencontainers.image.source="https://github.com/iuliandita/digarr"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="digarr"
LABEL org.opencontainers.image.description="Music discovery and recommendation pipeline"
LABEL org.opencontainers.image.vendor="iuliandita"

WORKDIR /app

# Non-root user (bun base image ships with bun:bun at UID/GID 1000)

COPY --from=deps-prod /app/package.json /app/bun.lock ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY deploy/docker/healthcheck.sh /app/healthcheck.sh
RUN test -s /app/dist/scripts/rotate-encryption-key.js && chmod +x /app/healthcheck.sh

RUN mkdir -p /app/backups /app/data && chown bun:bun /app/backups /app/data
VOLUME ["/app/backups", "/app/data"]
ENV DB_PATH=/app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/app/healthcheck.sh"]

USER bun
CMD ["bun", "dist/server/index.js"]

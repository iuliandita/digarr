# syntax=docker/dockerfile:1.7

# Global ARG -- must be before any FROM to use in FROM instructions
ARG RUNTIME_IMAGE=oven/bun:1.3.13-slim@sha256:7e8ed3961db1cdedf17d516dda87948cfedbd294f53bf16462e5b57ed3fff0f1

# Deps stage -- all deps (dev + prod) for the builder. Cache-mount accelerates rebuilds.
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile

# Build stage -- reuses deps, produces dist/.
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Deps-prod stage -- production-only deps, shared cache id.
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS deps-prod
WORKDIR /app
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --production

# Runtime stage -- override RUNTIME_IMAGE for alpine variant.
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
RUN chmod +x /app/healthcheck.sh

RUN mkdir -p /app/backups && chown bun:bun /app/backups
VOLUME ["/app/backups"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/app/healthcheck.sh"]

USER bun
CMD ["bun", "dist/server/index.js"]

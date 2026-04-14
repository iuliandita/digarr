# syntax=docker/dockerfile:1

# Global ARG -- must be before any FROM to use in FROM instructions
ARG RUNTIME_IMAGE=oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9

# Build stage -- always Debian for consistent toolchain
FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Runtime stage -- override RUNTIME_IMAGE for alpine variant
FROM ${RUNTIME_IMAGE}
WORKDIR /app

# Non-root user (bun base image ships with bun:bun at UID/GID 1000)

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production \
    && rm -rf /tmp/* /home/bun/.bun/install/cache

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER bun
CMD ["bun", "dist/server/index.js"]

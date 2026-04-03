# syntax=docker/dockerfile:1

# Global ARG -- must be before any FROM to use in FROM instructions
ARG RUNTIME_IMAGE=oven/bun:1.3.11-slim

# Build stage -- always Debian for consistent toolchain
FROM oven/bun:1.3.11 AS builder
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

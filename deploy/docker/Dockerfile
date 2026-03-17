# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Runtime stage -- production deps only
FROM oven/bun:1-slim
WORKDIR /app

# Non-root user
RUN groupadd --system digarr && useradd --system --gid digarr digarr

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production && rm -rf /tmp/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER digarr
CMD ["bun", "dist/server/index.js"]

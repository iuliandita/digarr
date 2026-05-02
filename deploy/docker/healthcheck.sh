#!/bin/sh
# Shared container healthcheck -- invoked by both Dockerfile HEALTHCHECK and
# compose `healthcheck.test`. Uses bun (always present in the runtime image)
# so the same script works on slim (Debian, no wget/curl) and alpine (musl).
set -eu
export PORT="${PORT:-3000}"

case "$PORT" in
  '' | *[!0-9]*)
    printf 'invalid PORT for healthcheck: %s\n' "$PORT" >&2
    exit 1
    ;;
esac

exec bun -e 'const port = process.env.PORT ?? "3000"; fetch("http://127.0.0.1:" + port + "/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

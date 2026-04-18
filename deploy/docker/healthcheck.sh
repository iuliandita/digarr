#!/bin/sh
# Shared container healthcheck -- invoked by both Dockerfile HEALTHCHECK and
# compose `healthcheck.test`. Uses bun (always present in the runtime image)
# so the same script works on slim (Debian, no wget/curl) and alpine (musl).
set -eu
PORT="${PORT:-3000}"
exec bun -e "fetch('http://localhost:${PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

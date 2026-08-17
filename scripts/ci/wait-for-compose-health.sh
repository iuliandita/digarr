#!/usr/bin/env bash
# Wait for a podman-compose service container to report healthy.
#
# podman-compose resolves `depends_on: condition: service_healthy` with an
# unbounded `while True` around `podman wait --condition=healthy`, so a service
# whose healthcheck never reports hangs `up` instead of failing it -- the whole
# job then dies at its own timeout with no logs, because a job-level timeout
# skips the `if: failure()` diagnostics. Gating on health here bounds the wait
# and prints the state needed to tell "the healthcheck never ran" apart from
# "postgres is broken" (issue #601).
#
# Usage: wait-for-compose-health.sh <service> [timeout-seconds]
set -euo pipefail

SERVICE="${1:?usage: wait-for-compose-health.sh <service> [timeout-seconds]}"
TIMEOUT="${2:-120}"

container=""
for _ in $(seq 1 10); do
  container=$(podman ps -aq --filter "label=io.podman.compose.service=$SERVICE" | head -1)
  if [[ -n "$container" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$container" ]]; then
  printf 'no container found for compose service %s\n' "$SERVICE" >&2
  podman ps -a >&2
  exit 1
fi

deadline=$((SECONDS + TIMEOUT))
status=unknown
while ((SECONDS < deadline)); do
  status=$(podman inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)
  case "$status" in
    healthy)
      printf '%s reported healthy after %ss\n' "$SERVICE" "$SECONDS"
      exit 0
      ;;
    unhealthy)
      break
      ;;
  esac
  sleep 2
done

printf '%s never reported healthy within %ss (last status: %s)\n' "$SERVICE" "$TIMEOUT" "$status" >&2
printf '=== health state ===\n' >&2
podman inspect --format '{{json .State.Health}}' "$container" >&2 || true
printf '\n=== container state ===\n' >&2
podman inspect --format '{{json .State}}' "$container" >&2 || true
printf '\n=== container logs ===\n' >&2
podman logs --tail 100 "$container" >&2 || true
exit 1

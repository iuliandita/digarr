#!/usr/bin/env bash
# Wait for a podman-compose service container to report healthy.
#
# podman-compose resolves `depends_on: condition: service_healthy` with an
# unbounded `while True` around `podman wait --condition=healthy`, so a service
# whose healthcheck never reports hangs `up` instead of failing it -- the whole
# job then dies at its own timeout with no logs, because a job-level timeout
# skips the `if: failure()` diagnostics.
#
# Under podman 5.8.4 on the hosted runner the scheduled healthcheck never fires
# at all: postgres logs "ready to accept connections" a second after start, yet
# health sits at {"Status":"starting","FailingStreak":0,"Log":null} indefinitely.
# Only the timer is broken -- running the probe by hand records a result and
# flips the container healthy, which is also what releases podman-compose's
# wait. So drive the probe here rather than waiting on the scheduler (#601).
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
probe_output=""
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
  # Records a result even when the scheduled check never fires. A container
  # without a healthcheck errors here, which the next inspect reports anyway.
  probe_output=$(podman healthcheck run "$container" 2>&1) || true
  sleep 2
done

printf '%s never reported healthy within %ss (last status: %s)\n' "$SERVICE" "$TIMEOUT" "$status" >&2
printf '=== last manual probe ===\n%s\n' "$probe_output" >&2
printf '=== health state ===\n' >&2
podman inspect --format '{{json .State.Health}}' "$container" >&2 || true
printf '\n=== container state ===\n' >&2
podman inspect --format '{{json .State}}' "$container" >&2 || true
printf '\n=== container logs ===\n' >&2
podman logs --tail 100 "$container" >&2 || true
exit 1

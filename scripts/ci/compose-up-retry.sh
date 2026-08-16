#!/usr/bin/env bash
# Bring a compose stack up, retrying past transient registry failures.
#
# The compatibility jobs run four `up -d --build` invocations per workflow, each
# pulling base images. A single truncated layer ("short read: expected N bytes
# but got M: unexpected EOF") otherwise kills the whole job, which says nothing
# about the thing under test.
#
# Usage: compose-up-retry.sh <compose-command> [compose-args...]
#   compose-up-retry.sh docker compose -f docker-compose.yml -f docker-compose.compat.yml
#   compose-up-retry.sh podman-compose -f docker-compose.pglite.yml
set -euo pipefail

ATTEMPTS="${COMPOSE_UP_ATTEMPTS:-3}"
DELAY="${COMPOSE_UP_RETRY_DELAY:-15}"

if [[ "$#" -lt 1 ]]; then
  printf 'usage: %s <compose-command> [compose-args...]\n' "$0" >&2
  exit 2
fi

for attempt in $(seq 1 "$ATTEMPTS"); do
  if "$@" up -d --build; then
    exit 0
  fi

  if [[ "$attempt" -eq "$ATTEMPTS" ]]; then
    printf 'compose up failed after %s attempts\n' "$ATTEMPTS" >&2
    exit 1
  fi

  # Tear down first: a partial stack from the failed attempt would otherwise
  # leave the retry reusing half-created containers and volumes.
  printf 'compose up failed (attempt %s/%s); tearing down and retrying in %ss\n' \
    "$attempt" "$ATTEMPTS" "$DELAY" >&2
  "$@" down -v || true
  sleep "$DELAY"
done

#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  if [[ "${DIGARR_ALLOW_MISSING_DOCKER:-0}" == "1" ]]; then
    printf 'docker unavailable; skipping runtime identity check\n'
    exit 0
  fi
  printf 'error: docker not found on PATH\n' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="digarr:identity-check-$$"
container="digarr-identity-check-$$"

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  docker image rm "${image}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build \
  --file "${repo_root}/deploy/docker/Dockerfile" \
  --build-arg DIGARR_GIT_SHA=ci-identity-sha \
  --build-arg DIGARR_CHANNEL=nightly \
  --tag "${image}" \
  "${repo_root}"

docker run --detach --name "${container}" "${image}" >/dev/null

for _ in {1..30}; do
  if docker exec "${container}" /app/healthcheck.sh >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "${container}" bun -e '
  const response = await fetch("http://127.0.0.1:3000/health")
  const health = await response.json()
  if (health.gitSha !== "ci-identity-sha" || health.channel !== "nightly") {
    console.error(JSON.stringify(health))
    process.exit(1)
  }
  console.log(`runtime identity: ${health.gitSha} ${health.channel}`)
'

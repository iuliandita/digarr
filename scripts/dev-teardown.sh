#!/usr/bin/env bash
set -euo pipefail

readonly CONTAINER_NAME="digarr-pg"

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }

main() {
  if docker inspect "$CONTAINER_NAME" &>/dev/null; then
    printf 'stopping and removing %s...\n' "$CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME"
    green "postgres container removed"
  else
    green "no container to remove"
  fi

  printf '\ndata was in a docker volume. to also wipe the data:\n'
  printf "  docker volume rm \$(docker volume ls -q | grep digarr)\n\n"
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

readonly CONTAINER_NAME="digarr-pg"

red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "missing required command: $1"
    exit 1
  fi
}

main() {
  require_command docker

  if docker inspect "$CONTAINER_NAME" &>/dev/null; then
    printf 'stopping and removing %s...\n' "$CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME"
    green "postgres container removed"
  else
    green "no container to remove"
  fi

  printf '\ndata was in a docker volume. to also wipe the data:\n'
  printf "  docker volume ls --format '{{.Name}}' | while IFS= read -r volume; do case \"\$volume\" in digarr*) docker volume rm \"\$volume\";; esac; done\n\n"
}

main "$@"

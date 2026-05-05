#!/usr/bin/env bash
set -euo pipefail

readonly CONTAINER_NAME="digarr-pg"
readonly DB_USER="digarr"
readonly DB_PASS="digarr"
readonly DB_NAME="digarr"
readonly DB_PORT="5432"
readonly DEV_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}"

red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
blue() { printf '\033[0;34m%s\033[0m\n' "$*"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "missing required command: $1"
    exit 1
  fi
}

ensure_commands() {
  require_command git
  require_command docker
  require_command pg_isready
  require_command bun
}

ensure_postgres_container() {
  if docker inspect "$CONTAINER_NAME" &>/dev/null; then
    if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" == "true" ]]; then
      green "postgres already running ($CONTAINER_NAME)"
      return
    fi

    blue "starting existing postgres container..."
    docker start "$CONTAINER_NAME"
    return
  fi

  blue "creating postgres container..."
  docker run -d --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASS" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "${DB_PORT}:5432" \
    postgres:17-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609
}

wait_for_postgres() {
  blue "waiting for postgres to accept connections..."

  for attempt in {1..30}; do
    if pg_isready -h localhost -p "$DB_PORT" -U "$DB_USER" &>/dev/null; then
      green "postgres ready"
      return
    fi

    if [[ "$attempt" -eq 30 ]]; then
      red "postgres did not start in time"
      exit 1
    fi

    sleep 1
  done
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    blue "creating .env from .env.example..."
    cp .env.example .env
    return
  fi

  green ".env already exists"
}

ensure_dependencies() {
  if [[ ! -d node_modules ]]; then
    blue "installing dependencies..."
    bun install
    return
  fi

  green "node_modules exists (run 'bun install' manually if stale)"
}

print_next_steps() {
  printf '\nstart the dev servers in two terminals:\n\n'
  printf '  terminal 1 (backend):  bun run dev\n'
  printf '  terminal 2 (frontend): bun run dev:web\n\n'
  printf 'then open http://localhost:5173\n\n'
}

main() {
  ensure_commands
  cd "$(git rev-parse --show-toplevel)"

  ensure_postgres_container
  wait_for_postgres
  ensure_env_file
  ensure_dependencies

  blue "running database migrations..."
  env DATABASE_URL="$DEV_DATABASE_URL" bun run db:migrate

  green "setup complete"
  print_next_steps
}

main "$@"

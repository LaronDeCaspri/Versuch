#!/usr/bin/env bash
# Bootstraps this repo for a fresh (ephemeral) Claude Code session so tests and
# the app can run: ensures Postgres is up with the dev + test databases,
# installs workspace deps, and applies migrations. Every step is best-effort —
# the hook must never block the session, so failures are reported and skipped.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL_DEV="postgresql://dev:dev@127.0.0.1:5432/compliance?schema=public"
DB_URL_TEST="postgresql://dev:dev@127.0.0.1:5432/compliance_test?schema=public"

log() { echo "[session-bootstrap] $*"; }

# 1) Postgres
if ! pg_isready -q 2>/dev/null; then
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    log "starting Postgres cluster"
    pg_ctlcluster 16 main start >/dev/null 2>&1 || true
    sleep 2
  fi
fi
if pg_isready -q 2>/dev/null && command -v psql >/dev/null 2>&1; then
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='dev'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -c \"CREATE USER dev WITH PASSWORD 'dev' SUPERUSER;\"" >/dev/null 2>&1 || true
  for db in compliance compliance_test; do
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" 2>/dev/null | grep -q 1 \
      || su postgres -c "psql -c \"CREATE DATABASE $db OWNER dev;\"" >/dev/null 2>&1 || true
  done
else
  log "Postgres unavailable; skipping DB setup"
fi

# 2) Dependencies
if command -v pnpm >/dev/null 2>&1; then
  log "installing dependencies"
  (cd "$ROOT" && pnpm install --prefer-offline >/dev/null 2>&1) || log "pnpm install failed"
fi

# 3) Migrations (dev + test) and Prisma client
if pg_isready -q 2>/dev/null; then
  log "applying migrations"
  (cd "$ROOT/packages/db" && DATABASE_URL="$DB_URL_DEV" pnpm exec prisma migrate deploy >/dev/null 2>&1) || true
  (cd "$ROOT/packages/db" && DATABASE_URL="$DB_URL_TEST" pnpm exec prisma migrate deploy >/dev/null 2>&1) || true
  (cd "$ROOT/packages/db" && pnpm exec prisma generate >/dev/null 2>&1) || true
fi

log "ready"
exit 0

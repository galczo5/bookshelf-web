#!/bin/sh
# Entrypoint for the all-in-one Docker image.
# Sequence: Postgres init → start PG → wait ready → generate secrets →
#           run migrations → supervise Node (restart on config/sentinel change).
# Runs as root so it can fix volume ownership; uses su-exec to drop privileges
# for Postgres and Node processes.
set -e

PGDATA="${PGDATA:-/data/pgdata}"
CONFIG_FILE="${BOOKSHELF_CONFIG_FILE:-/data/config.env}"
SENTINEL="${BOOKSHELF_RELOAD_SENTINEL:-/data/reload}"

DB_USER=bookshelf
DB_PASS=bookshelf
DB_NAME=bookshelf
DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

# ── Locate pg binaries ──────────────────────────────────────────────────────
# Alpine places server binaries under a versioned path (e.g. /usr/lib/postgresql17/bin).
PG_BIN=$(find /usr -name "initdb" -type f 2>/dev/null | head -1)
if [ -z "$PG_BIN" ]; then
  echo "[entrypoint] ERROR: initdb not found — postgresql not installed?" >&2
  exit 1
fi
PG_BIN_DIR=$(dirname "$PG_BIN")
export PATH="$PATH:$PG_BIN_DIR"

# ── Postgres data directory ─────────────────────────────────────────────────
# /data is the volume root; make it world-accessible so the nextjs user can
# write the config file and sentinel.
chmod 755 /data 2>/dev/null || true

mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

# Postgres needs this directory for its Unix socket lock file
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

# ── First-boot: initialize the cluster ─────────────────────────────────────
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] First boot: initializing Postgres data directory..."
  su-exec postgres initdb \
    --pgdata="$PGDATA" \
    --username=postgres \
    --encoding=UTF8 \
    --locale=C
  # Allow password-authenticated TCP connections from localhost
  printf 'host\tall\tall\t127.0.0.1/32\tmd5\n' >> "$PGDATA/pg_hba.conf"
  printf 'host\tall\tall\t::1/128\t\tmd5\n'     >> "$PGDATA/pg_hba.conf"
  echo "[entrypoint] Postgres initialized."
fi

# ── Start Postgres ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting Postgres..."
su-exec postgres pg_ctl -D "$PGDATA" -l "$PGDATA/postmaster.log" start

echo "[entrypoint] Waiting for Postgres to be ready..."
until su-exec postgres pg_isready -q 2>/dev/null; do sleep 1; done
echo "[entrypoint] Postgres is ready."

# ── Create DB user + database (idempotent) ──────────────────────────────────
if ! su-exec postgres psql -U postgres -tc \
    "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  su-exec postgres psql -U postgres -c \
    "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
fi

if ! su-exec postgres psql -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  su-exec postgres psql -U postgres -c \
    "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

export DATABASE_URL

# ── Generate secrets (first boot) ──────────────────────────────────────────
touch "$CONFIG_FILE"
chown nextjs:nodejs "$CONFIG_FILE" 2>/dev/null || true
chmod 600 "$CONFIG_FILE"  2>/dev/null || true

if ! grep -qs "^AUTH_SECRET=" "$CONFIG_FILE"; then
  printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> "$CONFIG_FILE"
fi
if ! grep -qs "^AUTH_TOKENS_ENCRYPTION_KEY=" "$CONFIG_FILE"; then
  printf 'AUTH_TOKENS_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> "$CONFIG_FILE"
fi
if ! grep -qs "^DATABASE_URL=" "$CONFIG_FILE"; then
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL" >> "$CONFIG_FILE"
fi

# ── Migrations ──────────────────────────────────────────────────────────────
echo "[entrypoint] Running database migrations..."
node /app/dist/scripts/migrate.mjs
echo "[entrypoint] Migrations complete."

# ── Supervision helpers ─────────────────────────────────────────────────────
NODE_PID=""

cleanup() {
  echo "[entrypoint] Shutting down..."
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID"
    wait "$NODE_PID" 2>/dev/null || true
  fi
  su-exec postgres pg_ctl -D "$PGDATA" stop -m fast 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

get_mtime() {
  stat -c "%Y" "$1" 2>/dev/null || echo "0"
}

start_node() {
  # Source the latest config so Node inherits all secrets/credentials
  if [ -f "$CONFIG_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
    set +a
  fi
  echo "[supervisor] Starting Node..."
  su-exec nextjs node /app/server.js &
  NODE_PID=$!
}

# ── Supervision loop ────────────────────────────────────────────────────────
CONFIG_MTIME=$(get_mtime "$CONFIG_FILE")
SENTINEL_MTIME=$(get_mtime "$SENTINEL")

start_node

while true; do
  sleep 1

  NEW_CONFIG_MTIME=$(get_mtime "$CONFIG_FILE")
  NEW_SENTINEL_MTIME=$(get_mtime "$SENTINEL")

  if [ "$NEW_CONFIG_MTIME" != "$CONFIG_MTIME" ] || \
     [ "$NEW_SENTINEL_MTIME" != "$SENTINEL_MTIME" ]; then
    echo "[supervisor] Config change detected — restarting Node..."
    if kill -0 "$NODE_PID" 2>/dev/null; then
      kill -TERM "$NODE_PID"
      wait "$NODE_PID" 2>/dev/null || true
    fi
    CONFIG_MTIME=$(get_mtime "$CONFIG_FILE")
    SENTINEL_MTIME=$(get_mtime "$SENTINEL")
    start_node
    continue
  fi

  # Restart if Node exited unexpectedly
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    wait "$NODE_PID" 2>/dev/null || true
    echo "[supervisor] Node exited unexpectedly — restarting in 1s..."
    sleep 1
    start_node
  fi
done

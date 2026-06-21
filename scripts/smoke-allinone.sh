#!/bin/sh
# Smoke test for the all-in-one Docker image.
# Boots a throwaway container, asserts the critical boot path, then tears down.
#
# Usage:
#   bash scripts/smoke-allinone.sh            # uses bookshelf:test
#   bash scripts/smoke-allinone.sh my-image:v2
#
# Environment:
#   SMOKE_PORT   host port to bind (default: 3001; avoid 3000 to not clash with dev server)
#
# Requirements: docker, curl
# Exit 0 = all checks passed; non-zero = failure (message + container logs printed).
#
# To verify the test fails loudly on a broken image:
#   docker build -f Dockerfile.allinone --build-arg BREAK=1 -t bookshelf:broken . \
#     && bash scripts/smoke-allinone.sh bookshelf:broken
#   (or run with a non-existent image name — the script exits non-zero immediately)
set -e

IMAGE="${1:-bookshelf:test}"
CONTAINER="bookshelf-smoke-$$"
VOLUME="bookshelf-smoke-vol-$$"
APP_PORT="${SMOKE_PORT:-3001}"
BASE_URL="http://localhost:${APP_PORT}"
PASS_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf "\033[32m✓\033[0m %s\n" "$*"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }
info() { printf "  %s\n" "$*"; }

cleanup() {
  rc=$?
  info "Tearing down $CONTAINER and $VOLUME..."
  docker rm -f "$CONTAINER" 2>/dev/null || true
  docker volume rm "$VOLUME" 2>/dev/null || true
  if [ $rc -ne 0 ]; then
    printf "\n\033[31m=== Smoke test FAILED ===\033[0m\n" >&2
  fi
}
trap cleanup EXIT

printf "=== Bookshelf all-in-one smoke test (%s) ===\n\n" "$IMAGE"

# ── 1. Start container ───────────────────────────────────────────────────────
info "Starting $CONTAINER on port $APP_PORT..."
docker run -d \
  --name "$CONTAINER" \
  -p "${APP_PORT}:3000" \
  -v "${VOLUME}:/data" \
  "$IMAGE"

# ── 2. Wait for /api/health (app up, PG ready, migrations done) ──────────────
info "Waiting for /api/health to respond (up to 120s)..."
ELAPSED=0
until curl -sf --max-time 3 "${BASE_URL}/api/health" > /dev/null 2>&1; do
  sleep 2; ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge 120 ]; then
    info "Container logs:"
    docker logs "$CONTAINER" 2>&1 | tail -30 >&2
    fail "/api/health did not respond within 120s — entrypoint may have crashed"
  fi
done
pass "/api/health responds (app up)"

# ── 3. /setup returns 200 pre-config ────────────────────────────────────────
SETUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE_URL}/setup")
[ "$SETUP_STATUS" = "200" ] || fail "/setup returned HTTP $SETUP_STATUS pre-config (expected 200)"
pass "/setup returns HTTP 200 pre-config"

# ── 4. Postgres is healthy ───────────────────────────────────────────────────
docker exec -i "$CONTAINER" sh << 'INNER'
PG_READY=$(find /usr -name pg_isready -type f 2>/dev/null | head -1)
[ -n "$PG_READY" ] || { echo "pg_isready not found" >&2; exit 1; }
su-exec postgres "$PG_READY" -q || { echo "pg_isready returned non-zero" >&2; exit 1; }
INNER
pass "Postgres is healthy"

# ── 5. Migrations ran — books table exists ───────────────────────────────────
TABLES=$(docker exec -i "$CONTAINER" sh << 'INNER' | tr -d '[:space:]'
PG_CLI=$(find /usr -name psql -type f 2>/dev/null | head -1)
[ -n "$PG_CLI" ] || { echo "psql not found" >&2; exit 1; }
su-exec postgres "$PG_CLI" -U postgres -d bookshelf -tc \
  "SELECT COUNT(1) FROM pg_tables WHERE schemaname='public' AND tablename='books'" 2>/dev/null
INNER
)
[ "$TABLES" = "1" ] || fail "books table not found — migrations may not have run (got: '$TABLES')"
pass "Migrations ran (books table exists)"

# ── 6. Write fake config + trigger Node restart ──────────────────────────────
info "Writing test config and triggering restart..."
docker exec "$CONTAINER" sh -c \
  'printf "GOOGLE_CLIENT_ID=smoke-client-id\nGOOGLE_CLIENT_SECRET=smoke-client-secret\nOPENAI_API_KEY=sk-smoke-openai-key\nBOOKSHELF_ALLOWED_EMAIL=smoke@example.com\n" >> /data/config.env'
# Touch the reload sentinel — the supervise loop detects mtime change and restarts Node
docker exec "$CONTAINER" sh -c 'printf "%s" "$(date +%s)" > /data/reload'

# Allow the supervise loop to detect the sentinel, kill Node, and start a new process.
# The loop checks every 1s; Node startup adds a few more seconds.
info "Waiting 10s for Node to restart..."
sleep 10

# ── 7. App serves post-restart ───────────────────────────────────────────────
info "Checking app responds post-restart (up to 30s)..."
ELAPSED=0
HTTP_CODE=""
while true; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 --max-time 3 \
    "${BASE_URL}/api/health" 2>/dev/null || true)
  [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" != "000" ] && break
  sleep 2; ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge 30 ]; then
    info "Container logs:"
    docker logs "$CONTAINER" 2>&1 | tail -20 >&2
    fail "App did not respond within 30s after restart"
  fi
done
pass "App responds post-restart (HTTP ${HTTP_CODE})"

# ── Summary ──────────────────────────────────────────────────────────────────
printf "\n\033[32m=== Smoke test passed (%d checks) ===\033[0m\n" "$PASS_COUNT"

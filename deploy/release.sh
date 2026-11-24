#!/usr/bin/env bash
# Cold Post — build and switch the production container, with rollback.
#
# Run on the Oracle VM (or over SSH from GitHub Actions):
#   cd /opt/coldpost && bash deploy/release.sh <git-sha>
#
# A failed build never replaces the running deployment; a container that fails
# its health check is rolled back to the previous image automatically.
set -euo pipefail

cd "$(dirname "$0")/.."
REV="${1:-manual}"

if [ ! -f .env.production ]; then
  echo "Missing .env.production — copy .env.production.example and fill it in." >&2
  exit 1
fi

PREV_IMAGE="$(docker inspect -f '{{.Image}}' coldpost-api 2>/dev/null || true)"

echo "==> Building coldpost-api:$REV"
docker build -t "coldpost-api:$REV" -t coldpost-api:latest .

echo "==> Starting"
docker compose up -d --no-build

echo "==> Health check"
HEALTHY=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4100/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ -z "$HEALTHY" ]; then
  echo "Health check failed. Recent logs:" >&2
  docker compose logs --tail 60 api >&2 || true
  if [ -n "$PREV_IMAGE" ]; then
    echo "==> Rolling back to $PREV_IMAGE" >&2
    docker tag "$PREV_IMAGE" coldpost-api:latest
    docker compose up -d --no-build
  fi
  exit 1
fi

curl -fsS "http://127.0.0.1:4100/health"
echo
docker image prune -f >/dev/null
echo "==> Deployed $REV"

#!/usr/bin/env bash
# Checks the HANDOFF budgets against a built image: size < 25 MB, cold start < 1 s, idle memory < 30 MB.
# Usage: IMAGE=unloyalty:dev scripts/check-budgets.sh   (make budgets builds the image first)
set -euo pipefail

IMAGE=${IMAGE:-unloyalty:dev}
PORT=${PORT:-18080}
NAME=unloyalty-budget-$$
MAX_SIZE_MB=25
MAX_START_MS=1000
MAX_RSS_MB=30
IDLE_SECONDS=${IDLE_SECONDS:-30}

fail=0
check() { # name value limit unit
  if awk -v v="$2" -v l="$3" 'BEGIN { exit !(v < l) }'; then
    printf '  ok    %-12s %8s %s (< %s)\n' "$1" "$2" "$4" "$3"
  else
    printf '  FAIL  %-12s %8s %s (< %s)\n' "$1" "$2" "$4" "$3"
    fail=1
  fi
}

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "budgets for $IMAGE"
size_mb=$(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{ printf "%.1f", $1 / 1048576 }')
check "image size" "$size_mb" "$MAX_SIZE_MB" MB

docker create --name "$NAME" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null
start=$(date +%s%N)
docker start "$NAME" >/dev/null
until curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; do
  if (( ($(date +%s%N) - start) / 1000000 > 10000 )); then
    echo "  FAIL  server did not become healthy within 10 s"; docker logs "$NAME"; exit 1
  fi
  sleep 0.01
done
start_ms=$(( ($(date +%s%N) - start) / 1000000 ))
check "cold start" "$start_ms" "$MAX_START_MS" "ms (docker start → /api/health 200)"

# Exercise the app once (index, the big precached assets) before measuring idle memory.
curl -fsS "http://127.0.0.1:$PORT/" -o /dev/null
for asset in $(curl -fsS "http://127.0.0.1:$PORT/sw.js" | grep -o 'assets/[^"]*' | sort -u); do
  curl -fsS "http://127.0.0.1:$PORT/$asset" -o /dev/null
done
sleep "$IDLE_SECONDS"
rss_mb=$(docker stats --no-stream --format '{{.MemUsage}}' "$NAME" | awk '{
  v = $1; unit = v; gsub(/[0-9.]/, "", unit); gsub(/[^0-9.]/, "", v)
  if (unit == "KiB") v /= 1024; else if (unit == "GiB") v *= 1024; else if (unit == "B") v /= 1048576
  printf "%.1f", v }')
check "idle memory" "$rss_mb" "$MAX_RSS_MB" "MiB after ${IDLE_SECONDS}s idle"

exit $fail

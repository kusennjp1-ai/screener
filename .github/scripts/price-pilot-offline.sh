#!/usr/bin/env bash
# Proposed CI entrypoint only. No provider capture or publication route exists.
set -euo pipefail
umask 077

repo_root=$(git rev-parse --show-toplevel)
: "${RUNNER_TEMP:?GitHub runner temp directory is required}"
: "${GITHUB_RUN_ID:?exact run ID is required}"
: "${GITHUB_RUN_ATTEMPT:?exact run attempt is required}"
output="$RUNNER_TEMP/price-pilot-offline-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir -p "$output"
python3 "$repo_root/.github/scripts/price-pilot-offline-check.py" prepare --root "$repo_root" --output "$output"
command -v docker >/dev/null

sandbox=$(mktemp -d "$RUNNER_TEMP/price-pilot-offline-work.XXXXXX")
tag="price-pilot-offline-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
shared_name="$tag-shared"
isolated_name="$tag-isolated"
test_name="$tag-tests"
cleanup() {
  docker rm -f "$test_name" "$shared_name" "$isolated_name" >/dev/null 2>&1 || true
  # Only this run's disposable build context and socket directories are removed.
  rm -rf -- "$sandbox"
}
trap cleanup EXIT
mkdir -p "$sandbox/context/backend" "$sandbox/control" "$sandbox/isolated-control"
cp "$repo_root"/backend/requirements*.txt "$sandbox/context/backend/"
cp "$repo_root/.github/scripts/price-pilot-offline-constraints.txt" "$sandbox/context/"

# This is the only networked phase: official images and dependency installation.
# No application source, provider credentials, or capture commands run here.
docker pull python:3.11-slim-bookworm
docker pull redis:7.4.2-alpine
python_image=$(docker image inspect python:3.11-slim-bookworm --format '{{index .RepoDigests 0}}')
redis_image=$(docker image inspect redis:7.4.2-alpine --format '{{index .RepoDigests 0}}')
docker build --build-arg "PYTHON_IMAGE=$python_image" \
  --file "$repo_root/.github/scripts/price-pilot-offline.Dockerfile" \
  --tag "$tag" "$sandbox/context"
docker image inspect "$python_image" "$redis_image" "$tag" > "$output/images.json"

uid=$(id -u)
gid=$(id -g)
for kind in shared isolated; do
  if [ "$kind" = shared ]; then
    container_name="$shared_name"
    socket_dir="$sandbox/control"
  else
    container_name="$isolated_name"
    socket_dir="$sandbox/isolated-control"
  fi
  docker run --detach --name "$container_name" --network none \
    --user "$uid:$gid" --read-only --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 64 --memory 128m --workdir /tmp \
    --tmpfs "/tmp:rw,nosuid,nodev,size=16m,uid=$uid,gid=$gid" \
    --mount "type=bind,src=$socket_dir,dst=/control" \
    "$redis_image" redis-server --port 0 --unixsocket /control/redis.sock \
    --unixsocketperm 600 --save '' --appendonly no --dir /tmp \
    --maxmemory 32mb --maxmemory-policy noeviction
  ready=false
  for attempt in $(seq 1 40); do
    if docker exec "$container_name" redis-cli -s /control/redis.sock ping >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 0.25
  done
  if [ "$ready" != true ]; then
    docker logs "$container_name" > "$output/$kind-redis.log" 2>&1
    exit 1
  fi
done

docker create --name "$test_name" --network none \
  --user "$uid:$gid" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 3g \
  --tmpfs "/tmp:rw,nosuid,nodev,size=512m,uid=$uid,gid=$gid" \
  --mount "type=bind,src=$repo_root,dst=/work,readonly" \
  --mount "type=bind,src=$output,dst=/artifacts" \
  --mount "type=bind,src=$sandbox/control,dst=/control,readonly" \
  --mount "type=bind,src=$sandbox/isolated-control,dst=/isolated-control,readonly" \
  --env PRICE_PILOT_OFFLINE_REQUIRED=1 --env PYTHONPATH=/work/backend \
  --env PYTHONUNBUFFERED=1 --env PYTHONDONTWRITEBYTECODE=1 \
  --env PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  --env LITELLM_LOCAL_MODEL_COST_MAP=true --env REDIS_ENABLED=false \
  --env DATABASE_URL=postgresql://price-pilot-unused.invalid/price_pilot_unused \
  "$tag"
# Inspect the actual launched configuration, not just a declared environment flag.
docker inspect "$test_name" "$shared_name" "$isolated_name" > "$output/containers.json"
set +e
docker start --attach "$test_name"
status=$?
set -e
docker logs "$shared_name" > "$output/shared-redis.log" 2>&1
docker logs "$isolated_name" > "$output/isolated-redis.log" 2>&1
exit "$status"

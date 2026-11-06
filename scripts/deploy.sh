#!/usr/bin/env bash
# Roll out the latest code on the server.
#
# Run by GitHub Actions through a forced-command SSH key (see
# scripts/server-bootstrap.sh), so this is the only thing that key can do.
#
#   * $SSH_ORIGINAL_COMMAND carries the commit SHA that passed CI. It is used
#     only if it is a full SHA on origin/main; anything else deploys main.
#   * stdin may carry a short-lived registry token. With it, the app image that
#     CI already built and tested is pulled from GHCR (fast). Without it, or if
#     the pull fails, the image is built here (slow but self-sufficient).
#
# Can also be run by hand:  sudo -iu weekender /opt/weekender/scripts/deploy.sh
set -euo pipefail

IMAGE_REPO=${IMAGE_REPO:-ghcr.io/zezekim/weekender-app}
LOCAL_TAG=weekender-app:latest   # what docker-compose.yml runs
PREVIOUS_TAG=weekender-app:previous

# Everything lives in a function so bash parses the whole script before
# `git reset` can replace this file mid-run.
main() {
  local app_dir=${APP_DIR:-/opt/weekender}
  cd "$app_dir"

  local token=""
  if [[ ! -t 0 ]]; then
    IFS= read -r -t 5 token || true
  fi

  mkdir -p data
  exec 9>"$app_dir/data/.deploy.lock"
  flock -w 900 9 || { echo "Another deploy is still running." >&2; exit 1; }

  git fetch --quiet origin main
  local requested=${SSH_ORIGINAL_COMMAND:-} target=origin/main
  if [[ "$requested" =~ ^[0-9a-f]{40}$ ]]; then
    if git merge-base --is-ancestor "$requested" origin/main 2>/dev/null; then
      target=$requested
    else
      echo "Refusing $requested: not a commit on main." >&2
      exit 1
    fi
  fi

  local previous sha
  previous=$(git rev-parse HEAD)
  git reset --hard --quiet "$target"
  sha=$(git rev-parse HEAD)
  echo "→ Deploying $(git log -1 --format='%h %s') (was ${previous:0:7})"

  # Keep the running image so a failed deploy can roll back without rebuilding.
  docker image inspect "$LOCAL_TAG" >/dev/null 2>&1 && docker tag "$LOCAL_TAG" "$PREVIOUS_TAG"

  if [[ -n "$token" ]] && pull_image "$token" "$IMAGE_REPO:$sha"; then
    docker tag "$IMAGE_REPO:$sha" "$LOCAL_TAG"
    echo "  Using the CI-built image $IMAGE_REPO:${sha:0:7}"
    docker compose up -d --no-build --remove-orphans
  else
    echo "  No registry image available; building on the server."
    docker compose up -d --build --remove-orphans
  fi

  if wait_healthy; then
    docker image prune -f >/dev/null
    echo "✓ Deployed ${sha:0:7}"
  else
    echo "✗ App did not become healthy — rolling back to ${previous:0:7}" >&2
    docker compose logs --tail 40 app >&2 || true
    git reset --hard --quiet "$previous"
    if docker image inspect "$PREVIOUS_TAG" >/dev/null 2>&1; then
      docker tag "$PREVIOUS_TAG" "$LOCAL_TAG"
      docker compose up -d --no-build --remove-orphans
    else
      docker compose up -d --build --remove-orphans
    fi
    exit 1
  fi
}

pull_image() {
  local token=$1 image=$2 ok=0
  if printf '%s' "$token" | docker login ghcr.io -u token --password-stdin >/dev/null 2>&1; then
    docker pull --quiet "$image" >/dev/null 2>&1 && ok=1
    docker logout ghcr.io >/dev/null 2>&1 || true
  fi
  [[ $ok == 1 ]]
}

wait_healthy() {
  local cid status
  for _ in $(seq 1 60); do
    cid=$(docker compose ps -q app)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [[ $status == healthy ]] && return 0
    sleep 3
  done
  return 1
}

main "$@"
exit

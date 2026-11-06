#!/usr/bin/env bash
# Roll out a new version on the server.
#
# Run by GitHub Actions through a forced-command SSH key (see
# scripts/server-bootstrap.sh), so this is the only thing that key can do.
#
#   * $SSH_ORIGINAL_COMMAND is the commit SHA that passed CI. It must be a full
#     SHA on origin/main.
#   * stdin carries the job's short-lived registry token. With it, the script
#     deploys exactly the image CI built and tested (ghcr.io/…:<sha>). If that
#     image cannot be pulled, the deploy stops before anything is changed — it
#     never falls back to an untested build.
#   * Without a token (a manual run), the image is built on the server.
#
# Safety:
#   1. The new image is obtained before the checkout or containers change.
#   2. The running image is kept as weekender-app:previous.
#   3. Any failure after that point (a failing command or an unhealthy app)
#      triggers a rollback to the previous commit and image, without a rebuild.
#
# Manual use:   sudo -iu weekender /opt/weekender/scripts/deploy.sh
# Drills:       SIMULATE_FAILURE=pull|compose|unhealthy …/deploy.sh
#               (manual runs only; the CI key cannot set environment variables)
set -Eeuo pipefail

IMAGE_REPO=${IMAGE_REPO:-ghcr.io/zezekim/weekender-app}
LOCAL_TAG=weekender-app:latest # what docker-compose.yml runs
PREVIOUS_TAG=weekender-app:previous
APP_DIR=${APP_DIR:-/opt/weekender}
SIMULATE=${SIMULATE_FAILURE:-}

PREVIOUS_SHA=""
ROLLING_BACK=0

log() { printf '%s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# Everything runs inside main() so bash parses the whole script before
# `git reset` can replace this file mid-run.
main() {
  cd "$APP_DIR"

  local token=""
  if [[ ! -t 0 ]]; then
    IFS= read -r -t 5 token || true
  fi

  mkdir -p data
  exec 9>"$APP_DIR/data/.deploy.lock"
  flock -w 900 9 || fail "Another deploy is still running."

  # --- 1. Decide what to deploy -------------------------------------------------
  git fetch --quiet origin main
  local requested=${SSH_ORIGINAL_COMMAND:-} target
  if [[ -n "$requested" ]]; then
    [[ "$requested" =~ ^[0-9a-f]{40}$ ]] || fail "Refusing '$requested': not a full commit SHA."
    git merge-base --is-ancestor "$requested" origin/main 2>/dev/null || fail "Refusing ${requested:0:7}: not a commit on main."
    target=$requested
  else
    target=$(git rev-parse origin/main)
  fi
  PREVIOUS_SHA=$(git rev-parse HEAD)
  log "→ Deploying ${target:0:7} (currently ${PREVIOUS_SHA:0:7})"

  # --- 2. Get the new image BEFORE changing anything ----------------------------
  local mode
  if [[ -n "$token" ]]; then
    [[ "$SIMULATE" == pull ]] && fail "Simulated pull failure. Nothing was changed."
    pull_image "$token" "$IMAGE_REPO:$target" || fail "Could not pull the tested image $IMAGE_REPO:${target:0:7}. Nothing was changed."
    mode=registry
    log "  Pulled the CI-tested image $IMAGE_REPO:${target:0:7}"
  elif [[ -n "$SIMULATE" ]]; then
    mode=reuse # drills reuse the running image instead of a slow rebuild
    log "  Drill: reusing the running image"
  else
    mode=build
    log "  Manual run without a registry token: building on the server"
  fi

  # --- 3. Keep a rollback point, then switch --------------------------------------
  if docker image inspect "$LOCAL_TAG" >/dev/null 2>&1; then
    docker tag "$LOCAL_TAG" "$PREVIOUS_TAG"
  fi
  trap 'rollback "command failed (line $LINENO): $BASH_COMMAND"' ERR

  git reset --hard --quiet "$target"
  [[ "$SIMULATE" == compose ]] && false # drill: fails here, as a broken compose up would

  case $mode in
    registry) docker tag "$IMAGE_REPO:$target" "$LOCAL_TAG"; docker compose up -d --no-build --remove-orphans ;;
    reuse) docker compose up -d --no-build --remove-orphans ;;
    build) docker compose up -d --build --remove-orphans ;;
  esac
  restart_changed_config "$PREVIOUS_SHA"

  if [[ "$SIMULATE" == unhealthy ]] || ! wait_healthy; then
    rollback "the app did not become healthy"
  fi

  trap - ERR
  docker image prune -f >/dev/null
  log "✓ Deployed ${target:0:7} ($mode)"
}

rollback() {
  ((ROLLING_BACK)) && exit 1 # never recurse
  ROLLING_BACK=1
  trap - ERR
  set +e
  log "✗ Deploy failed: $1" >&2
  log "↩ Rolling back to ${PREVIOUS_SHA:0:7}" >&2
  # Only the app's own status lines; request logs are never echoed into CI output.
  docker compose logs --tail 200 app 2>/dev/null | grep -E "ERROR|Traceback|Exception" | tail -15 >&2

  local from
  from=$(git rev-parse HEAD)
  git reset --hard --quiet "$PREVIOUS_SHA"
  if docker image inspect "$PREVIOUS_TAG" >/dev/null 2>&1; then
    docker tag "$PREVIOUS_TAG" "$LOCAL_TAG"
    docker compose up -d --no-build --remove-orphans
  else
    docker compose up -d --build --remove-orphans # first-ever deploy: nothing retained yet
  fi
  restart_changed_config "$from"

  if wait_healthy; then
    log "↩ Rolled back: ${PREVIOUS_SHA:0:7} is running and healthy" >&2
  else
    log "‼ Rollback finished but the app is not healthy; investigate with 'docker compose logs app'" >&2
  fi
  exit 1
}

# Config files are bind-mounted, so a changed file doesn't recreate its container.
restart_changed_config() {
  local since=$1
  if ! git diff --quiet "$since" HEAD -- Caddyfile; then
    log "  Caddyfile changed; restarting Caddy"
    docker compose restart caddy
  fi
  if ! git diff --quiet "$since" HEAD -- authelia/configuration.yml; then
    log "  Authelia configuration changed; restarting Authelia"
    docker compose restart authelia
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

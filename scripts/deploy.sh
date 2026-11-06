#!/usr/bin/env bash
# Roll out the latest code on the server.
#
# Run by GitHub Actions through a forced-command SSH key (see
# scripts/server-bootstrap.sh), so this is the only thing that key can do.
# The commit SHA that passed CI arrives in $SSH_ORIGINAL_COMMAND; it is used
# only if it is a full SHA that exists on origin/main. Anything else deploys
# the tip of main.
#
# Can also be run by hand:  sudo -u weekender /opt/weekender/scripts/deploy.sh
set -euo pipefail

# Everything lives in a function so bash parses the whole script before
# `git reset` can replace this file mid-run.
main() {
  local app_dir=${APP_DIR:-/opt/weekender}
  cd "$app_dir"

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

  local previous
  previous=$(git rev-parse HEAD)
  git reset --hard --quiet "$target"
  echo "→ Deploying $(git log -1 --format='%h %s') (was ${previous:0:7})"

  docker compose up -d --build --remove-orphans

  if wait_healthy; then
    docker image prune -f >/dev/null
    echo "✓ Deployed $(git rev-parse --short HEAD)"
  else
    echo "✗ App did not become healthy — rolling back to ${previous:0:7}" >&2
    docker compose logs --tail 40 app >&2 || true
    git reset --hard --quiet "$previous"
    docker compose up -d --build --remove-orphans
    exit 1
  fi
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

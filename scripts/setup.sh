#!/usr/bin/env bash
# One-time setup: .env, Authelia secrets, admin user, data directories.
# Safe to re-run — existing secrets and users are kept.
#
#   ADMIN_USER=admin ADMIN_PASSWORD='…' scripts/setup.sh     # non-interactive
#   scripts/setup.sh                                          # prompts / generates
set -euo pipefail
cd "$(dirname "$0")/.."

AUTHELIA_IMAGE=authelia/authelia:4.39

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Run containers as the owner of this checkout (never root).
OWNER_UID=$(stat -c %u . 2>/dev/null || stat -f %u .)
OWNER_GID=$(stat -c %g . 2>/dev/null || stat -f %g .)
if [[ "$OWNER_UID" == 0 ]]; then
  echo "Refusing to run containers as root: chown this directory to an unprivileged user first." >&2
  exit 1
fi
sed -i.bak -e "s/^PUID=.*/PUID=${OWNER_UID}/" -e "s/^PGID=.*/PGID=${OWNER_GID}/" .env && rm -f .env.bak
chmod 600 .env

mkdir -p authelia/secrets data/app data/authelia
for name in jwt_secret session_secret storage_encryption_key; do
  if [[ ! -s "authelia/secrets/$name" ]]; then
    (umask 077 && openssl rand -hex 48 > "authelia/secrets/$name")
    echo "Generated authelia/secrets/$name"
  fi
done

if [[ ! -s authelia/users_database.yml ]]; then
  user=${ADMIN_USER:-admin}
  password=${ADMIN_PASSWORD:-}
  if [[ -z "$password" ]]; then
    password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
    generated=1
  fi
  hash=$(docker run --rm "$AUTHELIA_IMAGE" authelia crypto hash generate argon2 --password "$password" | sed -n 's/^Digest: //p')
  [[ -n "$hash" ]] || { echo "Could not generate password hash" >&2; exit 1; }
  (umask 077 && cat > authelia/users_database.yml <<EOF
users:
  ${user}:
    disabled: false
    displayname: "Weekender admin"
    password: "${hash}"
    email: admin@weekender.invalid
    groups: [admins]
EOF
)
  echo "Created Authelia user '${user}'."
  if [[ -n "${generated:-}" ]]; then
    echo "  Generated password (shown once — store it in a password manager): ${password}"
  fi
fi

chown -R "$OWNER_UID:$OWNER_GID" authelia/secrets authelia/users_database.yml data 2>/dev/null || true
chmod 700 authelia/secrets data/app data/authelia
chmod 600 authelia/secrets/* authelia/users_database.yml

echo
echo "Done. Start with:  docker compose up -d --build"
grep '^APP_DOMAIN=' .env | sed 's/^APP_DOMAIN=/Then open:          https:\/\//'

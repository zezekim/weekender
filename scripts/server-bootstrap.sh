#!/usr/bin/env bash
# Fresh Ubuntu server prep — run ONCE as root.
#
#   * installs Docker Engine + compose plugin (official apt repo)
#   * adds 2 GB swap on small instances so image builds don't run out of memory
#   * creates an unprivileged `weekender` user that owns /opt/weekender
#   * clones the repository
#   * firewall: allow only SSH (22), HTTP (80), HTTPS (443)
#   * optionally installs a CI deploy key restricted to scripts/deploy.sh
#
# It does NOT touch root's password, SSH keys or sshd_config.
#
#   REPO_URL=https://github.com/zezekim/weekender.git \
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA… github-actions" \
#   bash server-bootstrap.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

REPO_URL=${REPO_URL:-https://github.com/zezekim/weekender.git}
APP_DIR=${APP_DIR:-/opt/weekender}
APP_USER=weekender

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw openssl git

# --- Docker -------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker   # containers with restart: unless-stopped come back after reboot

# --- Swap (small VPS: the frontend build needs headroom) -----------------------
if [[ $(free -m | awk '/^Swap:/{print $2}') -lt 1536 && ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- App user + code -------------------------------------------------------------
id "$APP_USER" &>/dev/null || useradd --create-home --shell /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"   # lets deploy.sh run `docker compose` without root
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --quiet "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- CI deploy key: can ONLY run deploy.sh -------------------------------------
if [[ -n "${DEPLOY_PUBKEY:-}" ]]; then
  home=$(getent passwd "$APP_USER" | cut -d: -f6)
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$home/.ssh"
  line="command=\"$APP_DIR/scripts/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $DEPLOY_PUBKEY"
  touch "$home/.ssh/authorized_keys"
  grep -qF "$DEPLOY_PUBKEY" "$home/.ssh/authorized_keys" || echo "$line" >> "$home/.ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "$home/.ssh/authorized_keys" && chmod 600 "$home/.ssh/authorized_keys"
fi

# --- Firewall: SSH first so we never lock ourselves out --------------------------
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status verbose

echo
echo "Next (as $APP_USER):"
echo "  cd $APP_DIR && cp .env.example .env   # set APP_DOMAIN=<ip>.sslip.io and TLS_MODE=acme"
echo "  scripts/setup.sh && docker compose up -d --build"

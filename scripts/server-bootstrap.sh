#!/usr/bin/env bash
# Fresh Ubuntu server prep — run ONCE as root.
#   * installs Docker Engine + compose plugin (official apt repo)
#   * creates an unprivileged `weekender` user that owns the app files
#   * firewall: allow only SSH (22), HTTP (80), HTTPS (443)
# It does NOT touch root's password, SSH keys or sshd_config.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

apt-get update
apt-get install -y ca-certificates curl gnupg ufw openssl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker   # containers with restart: unless-stopped come back after reboot

id weekender &>/dev/null || useradd --create-home --shell /bin/bash weekender

# Firewall — SSH first so we never lock ourselves out.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status verbose

echo
echo "Next:"
echo "  1. copy the project to /opt/weekender and: chown -R weekender:weekender /opt/weekender"
echo "  2. cd /opt/weekender && set APP_DOMAIN=<ip>.sslip.io and TLS_MODE=<your email> in .env"
echo "  3. scripts/setup.sh && docker compose up -d --build"

#!/usr/bin/env bash
# ================================================================================
# One-time GCP Compute Engine VM setup
# Run as root or with sudo on a fresh Ubuntu 22.04 / Debian 12 instance
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/igrunskiy/telemetry-analyst/main/deploy/setup.sh | sudo bash
#   — or --
#   sudo bash setup.sh
# ================================================================================
set -euo pipefail

APP_DIR="/opt/telemetry-analyst"
APP_USER="telemetry"

echo "==> Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Installing Docker..."
apt-get install -y -qq ca-certificates curl gnupg

# Detect OS (Ubuntu or Debian)
. /etc/os-release
OS_ID="${ID}"  # e.g. ubuntu or debian

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Enabling Docker service..."
systemctl enable docker
systemctl start docker

echo "==> Creating app user '$APP_USER'..."
id -u "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

echo "==> Cloning repository..."
if [ -d "$APP_DIR" ]; then
  echo "    Directory $APP_DIR already exists, pulling latest..."
  cd "$APP_DIR" && git pull origin main
else
  git clone https://github.com/igrunskiy/telemetry-analyst.git "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Creating .env file..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"

  # Generate secrets automatically
  SECRET_KEY=$(openssl rand -base64 48)
  ENCRYPTION_KEY=$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" 2>/dev/null || openssl rand -base64 32)

  sed -i "s|SECRET_KEY=.*|SECRET_KEY=$SECRET_KEY|" "$APP_DIR/.env"
  sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$APP_DIR/.env"

  echo ""
  echo "    ================================================="
  echo "    .env created at $APP_DIR/.env"
  echo "    You MUST edit it to fill in:"
  echo "      - GARAGE61_CLIENT_ID"
  echo "      - GARAGE61_CLIENT_SECRET"
  echo "      - GARAGE61_REDIRECT_URI (http://<your-vm-ip>:8000/auth/callback)"
User=telemetry
WorkingDirectory=/opt/telemetry-analyst
ExecStart=/usr/bin/docker compose up -d --build
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable telemetry-analyst

echo "==> Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/telemetry-analyst/.env with your credentials"
echo "  2. Start the app:  sudo systemctl start telemetry-analyst"
echo "  3. Check status:   sudo systemctl status telemetry-analyst"
echo "  4. View logs:      cd /opt/telemetry-analyst && docker compose logs -f"
echo "  5. Open http://<your-vm-ip> in your browser"
echo ""

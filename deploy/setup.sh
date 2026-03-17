#!/usr/bin/env bash
# =============================================================================
# One-time GCP Debian/Ubuntu VM setup for Telemetry Analyst
#
# Usage (run as root or with sudo):
#   sudo bash setup.sh
#
# Optional env vars:
#   BRANCH    git branch to deploy (default: main)
#   REPO_URL  git repo URL (default: https://github.com/igrunskiy/telemetry-analyst.git)
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/igrunskiy/telemetry-analyst.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="/opt/telemetry-analyst"
APP_USER="telemetry"

echo "==> Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Installing Docker..."
apt-get install -y -qq ca-certificates curl gnupg git

# Detect OS (ubuntu or debian)
. /etc/os-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Enabling Docker..."
systemctl enable docker
systemctl start docker

echo "==> Creating app user '$APP_USER'..."
id -u "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

echo "==> Cloning repository (branch: $BRANCH)..."
if [ -d "$APP_DIR/.git" ]; then
  echo "    Repo exists — pulling latest..."
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Configuring .env..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"

  # Generate cryptographic secrets
  SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n')
  ENCRYPTION_KEY=$(python3 -c \
    "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" \
    2>/dev/null || openssl rand -base64 32 | tr -d '\n')

  # Detect public IP from GCP metadata
  PUBLIC_IP=$(curl -sf --max-time 5 \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/externalIp \
    -H "Metadata-Flavor: Google" 2>/dev/null || echo "YOUR_VM_IP")

  sed -i "s|SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" "$APP_DIR/.env"
  sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" "$APP_DIR/.env"
  sed -i "s|GARAGE61_REDIRECT_URI=.*|GARAGE61_REDIRECT_URI=http://${PUBLIC_IP}/auth/callback|" "$APP_DIR/.env"
  # DATABASE_URL must use 'db' (Docker internal service name), not localhost
  sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql+asyncpg://telemetry:telemetry_secret@db:5432/telemetry_analyst|" "$APP_DIR/.env"
  # Allow requests from the VM's public IP
  sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=[\"http://${PUBLIC_IP}\",\"http://localhost\"]|" "$APP_DIR/.env"

  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"

  echo ""
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  .env created — public IP detected: $PUBLIC_IP"
  echo "  │"
  echo "  │  YOU MUST EDIT $APP_DIR/.env and set:"
  echo "  │    GARAGE61_CLIENT_ID=<your value>"
  echo "  │    GARAGE61_CLIENT_SECRET=<your value>"
  echo "  │    CLAUDE_API_KEY=sk-ant-..."
  echo "  │"
  echo "  │  Register your Garage61 app with redirect URI:"
  echo "  │    http://${PUBLIC_IP}/auth/callback"
  echo "  └─────────────────────────────────────────────────────┘"
  echo ""
else
  echo "    .env already exists — skipping (delete to regenerate)"
fi

echo "==> Installing systemd service..."
cat > /etc/systemd/system/telemetry-analyst.service <<'SVCEOF'
[Unit]
Description=Telemetry Analyst
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=telemetry
WorkingDirectory=/opt/telemetry-analyst
ExecStart=/usr/bin/docker compose up -d --build --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable telemetry-analyst

PUBLIC_IP=$(curl -sf --max-time 3 \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/externalIp \
  -H "Metadata-Flavor: Google" 2>/dev/null || echo "YOUR_VM_IP")

echo ""
echo "==> Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Fill in credentials:  nano $APP_DIR/.env"
echo "  2. Start the app:        sudo systemctl start telemetry-analyst"
echo "  3. Watch build logs:     cd $APP_DIR && docker compose logs -f"
echo "  4. Open in browser:      http://${PUBLIC_IP}"
echo ""
echo "  If port 80 is blocked, open it with:"
echo "    gcloud compute firewall-rules create allow-http \\"
echo "      --allow tcp:80 --target-tags http-server"
echo "  Or add the 'http-server' network tag to your VM in the GCP console."
echo ""

#!/usr/bin/env bash
set -e

if [ ! -f .env ]; then
  echo "Creating .env file from .env.example..."
  cp .env.example .env

  echo "Generating security keys..."
  SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
  ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

  sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET_KEY|" .env
  sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" .env
  rm -f .env.bak

  echo "✅ Security keys generated."
  echo "⚠️  Fill in the following before continuing:"
  echo "   - GARAGE61_CLIENT_ID / GARAGE61_CLIENT_SECRET / GARAGE61_REDIRECT_URI"
  echo "   - CLAUDE_API_KEY and/or GEMINI_API_KEY"
  echo "   - DOMAIN (your public domain for HTTPS)"
  echo ""
  echo "Edit .env then re-run this script."
  exit 0
fi

echo "🚀 Pulling images and starting production containers..."
DOCKER_BUILDKIT=1 docker compose -f docker-compose.prod.yml pull
DOCKER_BUILDKIT=1 docker compose -f docker-compose.prod.yml up -d

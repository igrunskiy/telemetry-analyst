#!/usr/bin/env bash
set -e

if [ ! -f .env ]; then
  echo "Creating .env file from .env.example..."
  cp .env.example .env
  
  echo "Generating security keys..."
  SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
  ENCRYPTION_KEY=$(python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode('utf-8'))")
  
  # Append or replace keys in .env
  if grep -q "^SECRET_KEY=" .env; then
    # Compatible with both macOS and Linux sed
    sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET_KEY|" .env
    sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" .env
    rm -f .env.bak
  else
    echo "SECRET_KEY=$SECRET_KEY" >> .env
    echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
  fi
  echo "✅ Security keys generated and added to .env. Don't forget to fill in your API keys (Garage61, Claude/Gemini)!"
fi

echo "🚀 Building and starting Docker containers..."
DOCKER_BUILDKIT=1 docker compose up --build
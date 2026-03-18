# Telemetry Analyst

AI-powered iRacing telemetry analysis. Compares your laps against the fastest drivers and gives you a detailed improvement plan using Claude.

## Features

- **Garage61 integration** — log in with your Garage61 account, browse your laps
- **Auto-reference selection** — fetches the top 5 fastest laps for the same car/track/setup
- **AI analysis** — Claude analyzes telemetry deltas and identifies your weak zones
- **4 visualizations** — Racing lines, telemetry traces, track heatmap, sector delta chart
- **Multi-user** — each user logs in with their own Garage61 account
- **Mobile-friendly** — responsive design works on phones and tablets

## Prerequisites

1. **Garage61 developer app** — register at https://garage61.net/developer
   - App name: anything (e.g. "Telemetry Analyst")
   - Redirect URI: `http://localhost/auth/callback`
   - Required permission: `driving_data`
   - Note your **Client ID** and **Client Secret**

2. **Claude API key** — get one at https://console.anthropic.com

3. **Docker + Docker Compose** installed

## Quick Start

```bash
# 1. Clone / navigate to the project
cd telemetry-analyst

# 2. Create your .env file
cp .env.example .env

# 3. Edit .env with your credentials
#    - GARAGE61_CLIENT_ID
#    - GARAGE61_CLIENT_SECRET
#    - CLAUDE_API_KEY
#    - SECRET_KEY (generate a random string)
#    - ENCRYPTION_KEY (generate a Fernet key)
nano .env

# 4. Generate secrets (copy output into .env)
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64))"
python3 -c "from cryptography.fernet import Fernet; print('ENCRYPTION_KEY=' + Fernet.generate_key().decode())"

# 5. Launch
docker compose up --build

# 6. Open http://localhost in your browser
```

## Production (pre-built images)

This repo includes `docker-compose.prod.yml` which runs the backend/frontend/proxy from pre-built images (GHCR).

On your VM:

1. (Once) `docker login ghcr.io`
2. Set image vars (either in your shell or in `/opt/telemetry-analyst/.env`):
   - `IMAGE_OWNER` (default: `igrunskiy`)
   - `IMAGE_REPO` (default: `telemetry-analyst`)
   - `IMAGE_TAG` (default: `latest`)
3. Deploy: `sudo -u telemetry bash /opt/telemetry-analyst/deploy/deploy-images.sh`

## Architecture

```
Browser → nginx (port 80)
            ├── /auth/* , /api/*  →  FastAPI backend (port 8000)
            └── /*               →  React SPA (nginx)

FastAPI → PostgreSQL (tokens, analysis cache)
       → Garage61 API (telemetry data)
       → Claude API (LLM analysis)
```

## Development (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend Vite dev server proxies `/api` and `/auth` to `localhost:8000`.

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async), PostgreSQL
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Plotly.js
- **LLM:** Claude Sonnet 4.6 (Anthropic API)
- **Infra:** Docker Compose, nginx

"""
FastAPI application entry point.

Registers middleware, routers, and lifespan events.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create all database tables on startup (development convenience)."""
    # Import models so SQLAlchemy registers them before create_all
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Cleanup: dispose the engine connection pool on shutdown
    await engine.dispose()


app = FastAPI(
    title="Telemetry Analyst API",
    description="Multi-user motorsport telemetry analysis powered by Garage61 and Claude AI",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from app.auth.router import router as auth_router
from app.api.laps import router as laps_router
from app.api.analysis import router as analysis_router
from app.api.profile import router as profile_router

app.include_router(auth_router)
app.include_router(laps_router)
app.include_router(analysis_router)
app.include_router(profile_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Simple liveness probe."""
    return {"status": "ok", "version": "1.0.0"}

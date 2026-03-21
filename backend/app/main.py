"""
FastAPI application entry point.

Registers middleware, routers, and lifespan events.
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from sqlalchemy import text

from app.database import Base, engine

# Configure logging with timestamps
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s - %(name)s.%(funcName)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

if settings.ENABLE_REMOTE_DEBUG:
    try:
        import debugpy

        debugpy.listen(("0.0.0.0", settings.REMOTE_DEBUG_PORT))
        logging.getLogger(__name__).info(
            "Remote debugpy listening on 0.0.0.0:%s",
            settings.REMOTE_DEBUG_PORT,
        )
        if settings.REMOTE_DEBUG_WAIT:
            logging.getLogger(__name__).info("Waiting for debug client to attach...")
            debugpy.wait_for_client()
    except Exception:
        logging.getLogger(__name__).exception("Failed to start remote debugpy")


async def _seed_default_admin(conn) -> None:
    """Create the default admin and user accounts if they don't exist yet."""
    import bcrypt
    from sqlalchemy import text as t

    now = datetime.now(timezone.utc)

    result = await conn.execute(
        t("SELECT id FROM users WHERE username = 'admin' LIMIT 1")
    )
    if result.fetchone() is None:
        password_hash = bcrypt.hashpw(b"admin-s3cr3t", bcrypt.gensalt()).decode()
        await conn.execute(
            t(
                "INSERT INTO users (id, username, password_hash, display_name, role, is_suspended, created_at, last_login_at) "
                "VALUES (gen_random_uuid(), 'admin', :pw, 'Administrator', 'admin', false, :now, :now)"
            ),
            {"pw": password_hash, "now": now},
        )
        logging.getLogger(__name__).info("Default admin account created (username: admin)")

    result = await conn.execute(
        t("SELECT id FROM users WHERE username = 'user' LIMIT 1")
    )
    if result.fetchone() is None:
        password_hash = bcrypt.hashpw(b"user", bcrypt.gensalt()).decode()
        await conn.execute(
            t(
                "INSERT INTO users (id, username, password_hash, display_name, role, is_suspended, created_at, last_login_at) "
                "VALUES (gen_random_uuid(), 'user', :pw, 'User', 'user', false, :now, :now)"
            ),
            {"pw": password_hash, "now": now},
        )
        logging.getLogger(__name__).info("Default user account created (username: user)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create all database tables on startup (development convenience)."""
    # Import models so SQLAlchemy registers them before create_all
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        # Prevent multiple workers from running DDL concurrently
        await conn.execute(text("SELECT pg_advisory_lock(987654321)"))
        try:
            await conn.run_sync(Base.metadata.create_all)
            # Add columns that may not exist in pre-existing tables
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "share_token VARCHAR UNIQUE"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "status VARCHAR(20) NOT NULL DEFAULT 'completed'"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "error_message TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "input_json JSONB"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_results_status "
                "ON analysis_results (status)"
            ))
            # New user auth columns
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR UNIQUE"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR UNIQUE"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_username ON users (username) WHERE username IS NOT NULL"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_email ON users (email) WHERE email IS NOT NULL"
            ))
            # Seed default admin
            await _seed_default_admin(conn)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(987654321)"))

    # Start the background analysis worker pool
    from app.analysis.worker import start_pool
    pool = start_pool(settings.ANALYSIS_WORKER_POOL_SIZE)

    yield

    # Stop the pool and dispose the engine connection pool on shutdown
    await pool.stop()
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
from app.api.admin import router as admin_router

app.include_router(auth_router)
app.include_router(laps_router)
app.include_router(analysis_router)
app.include_router(profile_router)
app.include_router(admin_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Simple liveness probe."""
    return {"status": "ok", "version": "1.0.0"}

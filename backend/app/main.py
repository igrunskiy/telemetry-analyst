"""
FastAPI application entry point.

Registers middleware, routers, and lifespan events.
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "version_group_id UUID"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "version_number INTEGER NOT NULL DEFAULT 1"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS "
                "is_default_version BOOLEAN NOT NULL DEFAULT true"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_results_status "
                "ON analysis_results (status)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_results_version_group_id "
                "ON analysis_results (version_group_id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_results_is_default_version "
                "ON analysis_results (is_default_version)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_telemetry_files_analysis_result_id "
                "ON analysis_telemetry_files (analysis_result_id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_telemetry_files_lap_id "
                "ON analysis_telemetry_files (lap_id)"
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
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_cars_source_platform "
                "ON telemetry_cars (source, platform_id)"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_cars_source_normalized "
                "ON telemetry_cars (source, normalized_name)"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_tracks_source_platform "
                "ON telemetry_tracks (source, platform_id)"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_tracks_source_normalized "
                "ON telemetry_tracks (source, normalized_name)"
            ))
            await conn.execute(text(
                "ALTER TABLE uploaded_telemetry ADD COLUMN IF NOT EXISTS car_id UUID"
            ))
            await conn.execute(text(
                "ALTER TABLE uploaded_telemetry ADD COLUMN IF NOT EXISTS track_id UUID"
            ))
            await conn.execute(text(
                "ALTER TABLE uploaded_telemetry ADD COLUMN IF NOT EXISTS air_temp_c DOUBLE PRECISION"
            ))
            await conn.execute(text(
                "ALTER TABLE uploaded_telemetry ADD COLUMN IF NOT EXISTS track_temp_c DOUBLE PRECISION"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS car_id UUID"
            ))
            await conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS track_id UUID"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE uploaded_telemetry ADD CONSTRAINT fk_uploaded_telemetry_car "
                "FOREIGN KEY (car_id) REFERENCES telemetry_cars(id) ON DELETE SET NULL; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE uploaded_telemetry ADD CONSTRAINT fk_uploaded_telemetry_track "
                "FOREIGN KEY (track_id) REFERENCES telemetry_tracks(id) ON DELETE SET NULL; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE analysis_results ADD CONSTRAINT fk_analysis_results_car "
                "FOREIGN KEY (car_id) REFERENCES telemetry_cars(id) ON DELETE SET NULL; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE analysis_results ADD CONSTRAINT fk_analysis_results_track "
                "FOREIGN KEY (track_id) REFERENCES telemetry_tracks(id) ON DELETE SET NULL; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "IF to_regclass('public.garage61_dictionary') IS NOT NULL THEN "
                "  INSERT INTO telemetry_cars (id, source, platform_id, name, normalized_name, created_at, updated_at) "
                "  SELECT gen_random_uuid(), 'garage61', d.platform_id, d.name, "
                "    lower(regexp_replace(trim(d.name), '\\s+', ' ', 'g')), d.created_at, d.updated_at "
                "  FROM ("
                "    SELECT DISTINCT ON (lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))) "
                "      platform_id, name, created_at, updated_at "
                "    FROM garage61_dictionary "
                "    WHERE entry_type = 'car' AND platform_id IS NOT NULL "
                "    ORDER BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g')), updated_at DESC"
                "  ) d "
                "  WHERE NOT EXISTS ("
                "    SELECT 1 FROM telemetry_cars tc "
                "    WHERE tc.source = 'garage61' AND ("
                "      tc.platform_id = d.platform_id OR "
                "      tc.normalized_name = lower(regexp_replace(trim(d.name), '\\s+', ' ', 'g'))"
                "    )"
                "  ); "
                "END IF; "
                "END $$;"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "IF to_regclass('public.garage61_dictionary') IS NOT NULL THEN "
                "  INSERT INTO telemetry_tracks (id, source, platform_id, name, variant, display_name, normalized_name, created_at, updated_at) "
                "  SELECT gen_random_uuid(), 'garage61', d.platform_id, d.name, d.variant, d.display_name, "
                "    lower(regexp_replace(trim(d.display_name), '\\s+', ' ', 'g')), d.created_at, d.updated_at "
                "  FROM ("
                "    SELECT DISTINCT ON (lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g'))) "
                "      platform_id, name, variant, display_name, created_at, updated_at "
                "    FROM garage61_dictionary "
                "    WHERE entry_type = 'track' AND platform_id IS NOT NULL "
                "    ORDER BY lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g')), updated_at DESC"
                "  ) d "
                "  WHERE NOT EXISTS ("
                "    SELECT 1 FROM telemetry_tracks tt "
                "    WHERE tt.source = 'garage61' AND ("
                "      tt.platform_id = d.platform_id OR "
                "      tt.normalized_name = lower(regexp_replace(trim(d.display_name), '\\s+', ' ', 'g'))"
                "    )"
                "  ); "
                "END IF; "
                "END $$;"
            ))
            await conn.execute(text(
                "INSERT INTO telemetry_cars (id, source, platform_id, name, normalized_name, created_at, updated_at) "
                "SELECT gen_random_uuid(), 'custom', NULL, car_name, lower(regexp_replace(trim(car_name), '\\s+', ' ', 'g')), NOW(), NOW() "
                "FROM (SELECT DISTINCT car_name FROM uploaded_telemetry WHERE car_name IS NOT NULL AND trim(car_name) <> '') cars "
                "ON CONFLICT (source, normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()"
            ))
            await conn.execute(text(
                "INSERT INTO telemetry_tracks (id, source, platform_id, name, variant, display_name, normalized_name, created_at, updated_at) "
                "SELECT gen_random_uuid(), 'custom', NULL, track_name, NULL, track_name, lower(regexp_replace(trim(track_name), '\\s+', ' ', 'g')), NOW(), NOW() "
                "FROM (SELECT DISTINCT track_name FROM uploaded_telemetry WHERE track_name IS NOT NULL AND trim(track_name) <> '') tracks "
                "ON CONFLICT (source, normalized_name) DO UPDATE SET display_name = EXCLUDED.display_name, name = EXCLUDED.name, updated_at = NOW()"
            ))
            await conn.execute(text(
                "UPDATE uploaded_telemetry ut SET car_id = tc.id "
                "FROM telemetry_cars tc "
                "WHERE ut.car_id IS NULL AND lower(regexp_replace(trim(ut.car_name), '\\s+', ' ', 'g')) = tc.normalized_name "
                "AND (tc.source = 'garage61' OR tc.source = 'custom')"
            ))
            await conn.execute(text(
                "UPDATE uploaded_telemetry ut SET track_id = tt.id "
                "FROM telemetry_tracks tt "
                "WHERE ut.track_id IS NULL AND lower(regexp_replace(trim(ut.track_name), '\\s+', ' ', 'g')) = tt.normalized_name "
                "AND (tt.source = 'garage61' OR tt.source = 'custom')"
            ))
            await conn.execute(text(
                "UPDATE analysis_results ar SET car_id = tc.id "
                "FROM telemetry_cars tc "
                "WHERE ar.car_id IS NULL AND lower(regexp_replace(trim(ar.car_name), '\\s+', ' ', 'g')) = tc.normalized_name "
                "AND (tc.source = 'garage61' OR tc.source = 'custom')"
            ))
            await conn.execute(text(
                "UPDATE analysis_results ar SET track_id = tt.id "
                "FROM telemetry_tracks tt "
                "WHERE ar.track_id IS NULL AND lower(regexp_replace(trim(ar.track_name), '\\s+', ' ', 'g')) = tt.normalized_name "
                "AND (tt.source = 'garage61' OR tt.source = 'custom')"
            ))
            await conn.execute(text(
                "UPDATE analysis_results SET version_group_id = id WHERE version_group_id IS NULL"
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


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request, exc: RequestValidationError):
    logger = logging.getLogger(__name__)
    try:
        body = await request.body()
        body_text = body.decode("utf-8", errors="replace")
    except Exception:
        body_text = "<unavailable>"
    logger.warning(
        "Request validation failed: path=%s errors=%s body=%s",
        request.url.path,
        exc.errors(),
        body_text[:4000],
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

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
from app.api.telemetry import router as telemetry_router
from app.api.profile import router as profile_router
from app.api.admin import router as admin_router

app.include_router(auth_router)
app.include_router(laps_router)
app.include_router(analysis_router)
app.include_router(telemetry_router)
app.include_router(profile_router)
app.include_router(admin_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Simple liveness probe."""
    return {"status": "ok", "version": "1.0.0"}

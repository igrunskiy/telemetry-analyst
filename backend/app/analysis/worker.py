"""
DB-based queue worker pool for background analysis processing.

Runs a configurable number of concurrent worker coroutines that all poll
the same PostgreSQL queue using SELECT FOR UPDATE SKIP LOCKED.

A watchdog task monitors running jobs and cancels any that exceed
ANALYSIS_WORKER_TIMEOUT (2 minutes).
"""

from __future__ import annotations

import asyncio
import logging
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.analysis import AnalysisResult
from app.models.user import User

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 2       # seconds between polls when queue is empty
_WATCHDOG_INTERVAL = 15  # how often the watchdog checks (seconds)


def _timeout() -> int:
    """Return the current job timeout from settings (allows runtime .env reload)."""
    return settings.ANALYSIS_WORKER_TIMEOUT


def _timeout_reason(timeout_seconds: int) -> str:
    return f"Job timed out after {timeout_seconds} seconds"


# ---------------------------------------------------------------------------
# Queue helpers
# ---------------------------------------------------------------------------

async def get_active_job_count(db: AsyncSession) -> int:
    """Return the number of jobs currently enqueued or processing (global)."""
    result = await db.execute(
        select(func.count(AnalysisResult.id)).where(
            AnalysisResult.status.in_(["enqueued", "processing"])
        )
    )
    return result.scalar_one()


async def get_queue_depth(db: AsyncSession) -> int:
    """Return the number of jobs waiting to be picked up."""
    result = await db.execute(
        select(func.count(AnalysisResult.id)).where(
            AnalysisResult.status == "enqueued"
        )
    )
    return result.scalar_one()


async def _claim_next_job(db: AsyncSession) -> AnalysisResult | None:
    """
    Atomically claim the oldest enqueued job.
    Uses SKIP LOCKED so multiple workers don't race on the same row.
    """
    result = await db.execute(
        select(AnalysisResult)
        .where(AnalysisResult.status == "enqueued")
        .order_by(AnalysisResult.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = result.scalar_one_or_none()
    if job is not None:
        job.status = "processing"
        await db.flush()
    return job


async def _mark_job_failed(job_id: uuid.UUID, reason: str) -> None:
    """Open a fresh DB session and mark a job as failed."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AnalysisResult).where(AnalysisResult.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.status = "failed"
                job.error_message = reason
                await db.commit()
    except Exception:
        logger.exception("Failed to mark job %s as failed in DB", job_id)


# ---------------------------------------------------------------------------
# Active task tracking
# ---------------------------------------------------------------------------

@dataclass
class _ActiveTask:
    job_id: uuid.UUID
    started_at: float    # time.monotonic() — for elapsed/timeout checks
    wall_started: float  # time.time() — for human-readable display
    task: asyncio.Task


# ---------------------------------------------------------------------------
# Worker pool
# ---------------------------------------------------------------------------

class WorkerPool:
    """
    Manages a pool of async worker loops and a watchdog that kills
    jobs running beyond ANALYSIS_WORKER_TIMEOUT.
    """

    def __init__(self, pool_size: int) -> None:
        self._pool_size = pool_size
        self._active: dict[uuid.UUID, _ActiveTask] = {}
        self._worker_tasks: list[asyncio.Task] = []
        self._watchdog_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def pool_size(self) -> int:
        return self._pool_size

    def get_status(self) -> dict:
        now_mono = time.monotonic()
        return {
            "pool_size": self._pool_size,
            "active_workers": len(self._active),
            "tasks": [
                {
                    "job_id": str(job_id),
                    "started_at": datetime.fromtimestamp(
                        t.wall_started, tz=timezone.utc
                    ).isoformat(),
                    "elapsed_seconds": round(now_mono - t.started_at, 1),
                    "timeout_seconds": _timeout(),
                }
                for job_id, t in self._active.items()
            ],
        }

    def start(self) -> None:
        for i in range(self._pool_size):
            t = asyncio.create_task(self._worker_loop(), name=f"worker-{i}")
            self._worker_tasks.append(t)
        self._watchdog_task = asyncio.create_task(
            self._watchdog_loop(), name="worker-watchdog"
        )
        logger.info("Worker pool started: %d workers", self._pool_size)

    async def stop(self) -> None:
        for t in self._worker_tasks:
            t.cancel()
        if self._watchdog_task:
            self._watchdog_task.cancel()
        all_tasks = self._worker_tasks + (
            [self._watchdog_task] if self._watchdog_task else []
        )
        await asyncio.gather(*all_tasks, return_exceptions=True)
        logger.info("Worker pool stopped")

    async def resize(self, new_size: int) -> None:
        """Adjust pool size at runtime. New workers start immediately."""
        old_size = self._pool_size
        self._pool_size = new_size
        # Grow
        while len(self._worker_tasks) < new_size:
            idx = len(self._worker_tasks)
            t = asyncio.create_task(self._worker_loop(), name=f"worker-{idx}")
            self._worker_tasks.append(t)
        # Shrink — cancelled workers finish their current job then exit
        while len(self._worker_tasks) > new_size:
            t = self._worker_tasks.pop()
            t.cancel()
        logger.info("Worker pool resized: %d -> %d", old_size, new_size)

    # ------------------------------------------------------------------
    # Internal loops
    # ------------------------------------------------------------------

    async def _watchdog_loop(self) -> None:
        logger.info(
            "Watchdog started (timeout=%ds, check every %ds)",
            _timeout(), _WATCHDOG_INTERVAL,
        )
        while True:
            try:
                await asyncio.sleep(_WATCHDOG_INTERVAL)
                now = time.monotonic()
                timeout = _timeout()
                timed_out = [
                    (job_id, t)
                    for job_id, t in list(self._active.items())
                    if now - t.started_at > timeout
                ]
                for job_id, active in timed_out:
                    elapsed = round(now - active.started_at, 1)
                    logger.warning(
                        "Watchdog: cancelling job %s — elapsed %.1fs > %ds limit",
                        job_id, elapsed, timeout,
                    )
                    active.task.cancel()
            except asyncio.CancelledError:
                logger.info("Watchdog stopped")
                return
            except Exception:
                logger.exception("Watchdog: unexpected error")

    async def _worker_loop(self) -> None:
        name = asyncio.current_task().get_name()
        logger.info("Worker loop started (%s)", name)
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    job = await _claim_next_job(db)
                    if job is None:
                        await asyncio.sleep(_POLL_INTERVAL)
                        continue
                    job_id = job.id
                    await db.commit()

                # Wrap job in its own Task so watchdog can cancel just the job
                job_task = asyncio.create_task(
                    _process_job(job_id), name=f"job-{job_id}"
                )
                active = _ActiveTask(
                    job_id=job_id,
                    started_at=time.monotonic(),
                    wall_started=time.time(),
                    task=job_task,
                )
                self._active[job_id] = active
                try:
                    timeout_seconds = _timeout()
                    await asyncio.wait_for(job_task, timeout=timeout_seconds)
                except asyncio.TimeoutError:
                    logger.warning(
                        "Worker: timing out job %s after %ds",
                        job_id, timeout_seconds,
                    )
                    if not job_task.done():
                        job_task.cancel()
                        await asyncio.gather(job_task, return_exceptions=True)
                    await _mark_job_failed(job_id, _timeout_reason(timeout_seconds))
                except asyncio.CancelledError:
                    # Two cases:
                    # 1. job_task was cancelled by watchdog (timeout)
                    # 2. this worker loop was cancelled (shutdown)
                    # Python 3.11+ cancelling() > 0 tells us it's case 2.
                    current = asyncio.current_task()
                    if current and current.cancelling() > 0:
                        # Worker loop itself is shutting down
                        if not job_task.done():
                            job_task.cancel()
                            await asyncio.gather(job_task, return_exceptions=True)
                        await _mark_job_failed(job_id, "Worker shutting down")
                        raise
                    # Case 1: watchdog timeout — mark failed, keep loop alive
                    await _mark_job_failed(job_id, _timeout_reason(_timeout()))
                finally:
                    self._active.pop(job_id, None)

            except asyncio.CancelledError:
                logger.info("Worker loop stopped (%s)", name)
                return
            except Exception:
                logger.exception("Worker: unexpected error in loop (%s)", name)
                await asyncio.sleep(_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Single-job processor
# ---------------------------------------------------------------------------

async def _process_job(job_id: uuid.UUID) -> None:
    """Run the analysis for a claimed job, updating status on completion or failure."""
    from app.analysis.executor import execute_analysis

    try:
        async with AsyncSessionLocal() as db:
            job_result = await db.execute(
                select(AnalysisResult).where(AnalysisResult.id == job_id)
            )
            job = job_result.scalar_one_or_none()
            if job is None:
                logger.warning("Worker: job %s not found, skipping", job_id)
                return

            user_result = await db.execute(
                select(User).where(User.id == job.user_id)
            )
            user = user_result.scalar_one_or_none()
            if user is None:
                raise ValueError(f"User {job.user_id} not found for job {job_id}")

            input_data = job.input_json or {}
            analysis_mode = input_data.get("analysis_mode", "vs_reference")
            laps_metadata = input_data.get("laps_metadata")
            llm_provider = input_data.get("llm_provider", "claude")
            prompt_version = input_data.get("prompt_version")
            uploaded_telemetry = input_data.get("uploaded_telemetry")

            result_json = await execute_analysis(
                lap_id=job.lap_id,
                reference_lap_ids=job.reference_lap_ids,
                car_name=job.car_name,
                track_name=job.track_name,
                analysis_mode=analysis_mode,
                laps_metadata=laps_metadata,
                llm_provider=llm_provider,
                prompt_version=prompt_version,
                uploaded_telemetry=uploaded_telemetry,
                user=user,
                db=db,
            )

            job.result_json = result_json
            job.status = "completed"
            job.error_message = None
            await db.commit()
            logger.info("Worker: job %s completed", job_id)

    except asyncio.CancelledError:
        # Let cancellation propagate so the worker loop can handle it
        raise
    except Exception as exc:
        logger.exception("Worker: job %s failed", job_id)
        tb = traceback.format_exc()
        await _mark_job_failed(job_id, f"{exc}\n\n{tb}")


# ---------------------------------------------------------------------------
# Module-level pool instance
# ---------------------------------------------------------------------------

_pool: WorkerPool | None = None


def get_pool() -> WorkerPool | None:
    return _pool


def start_pool(pool_size: int) -> WorkerPool:
    global _pool
    _pool = WorkerPool(pool_size)
    _pool.start()
    return _pool

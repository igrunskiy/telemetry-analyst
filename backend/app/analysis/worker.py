"""
DB-based queue worker for background analysis processing.

Uses PostgreSQL SELECT FOR UPDATE SKIP LOCKED so multiple server instances
share the same queue without stepping on each other.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.analysis import AnalysisResult
from app.models.user import User

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 2  # seconds between polls when queue is empty


async def get_active_job_count(db: AsyncSession) -> int:
    """Return the number of jobs currently enqueued or processing (global, across all users)."""
    result = await db.execute(
        select(func.count(AnalysisResult.id)).where(
            AnalysisResult.status.in_(["enqueued", "processing"])
        )
    )
    return result.scalar_one()


async def _claim_next_job(db: AsyncSession) -> AnalysisResult | None:
    """
    Atomically claim the oldest enqueued job.
    Uses SKIP LOCKED so multiple worker instances don't race on the same row.
    Returns the job with status already updated to 'processing', or None.
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


async def _process_job(job_id: uuid.UUID) -> None:
    """Run the analysis for a claimed job, updating its status on completion or failure."""
    from app.analysis.executor import execute_analysis

    try:
        # Load job and user in a fresh session
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

            result_json = await execute_analysis(
                lap_id=job.lap_id,
                reference_lap_ids=job.reference_lap_ids,
                car_name=job.car_name,
                track_name=job.track_name,
                analysis_mode=analysis_mode,
                laps_metadata=laps_metadata,
                llm_provider=llm_provider,
                user=user,
                db=db,
            )

            job.result_json = result_json
            job.status = "completed"
            job.error_message = None
            await db.commit()
            logger.info("Worker: job %s completed", job_id)

    except Exception as exc:
        logger.exception("Worker: job %s failed", job_id)
        try:
            async with AsyncSessionLocal() as db:
                job_result = await db.execute(
                    select(AnalysisResult).where(AnalysisResult.id == job_id)
                )
                job = job_result.scalar_one_or_none()
                if job:
                    job.status = "failed"
                    job.error_message = str(exc)
                    await db.commit()
        except Exception:
            logger.exception("Worker: failed to mark job %s as failed", job_id)


async def _worker_loop() -> None:
    """Main worker loop: poll for enqueued jobs and process them one at a time."""
    logger.info("Analysis queue worker started")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                job = await _claim_next_job(db)
                if job is None:
                    await asyncio.sleep(_POLL_INTERVAL)
                    continue
                job_id = job.id
                await db.commit()  # commit status=processing, release lock

            # Process outside the lock-holding session
            await _process_job(job_id)

        except asyncio.CancelledError:
            logger.info("Analysis queue worker stopped")
            return
        except Exception:
            logger.exception("Worker: unexpected error in loop")
            await asyncio.sleep(_POLL_INTERVAL)


def start_worker() -> asyncio.Task:
    """Launch the worker as a background asyncio task and return it."""
    return asyncio.create_task(_worker_loop(), name="analysis-queue-worker")

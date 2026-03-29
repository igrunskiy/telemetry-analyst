import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lap_id: Mapped[str] = mapped_column(String, nullable=False)
    reference_lap_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    car_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_cars.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_tracks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    car_name: Mapped[str] = mapped_column(String, nullable=False)
    track_name: Mapped[str] = mapped_column(String, nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    share_token: Mapped[str | None] = mapped_column(
        String, nullable=True, unique=True, index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    # Queue fields
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="completed",
        index=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stores processing inputs needed by the worker: analysis_mode, laps_metadata
    input_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Timestamp of last enqueue (set on initial enqueue and on re-run)
    enqueued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

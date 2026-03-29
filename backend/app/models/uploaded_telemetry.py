import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UploadedTelemetry(Base):
    __tablename__ = "uploaded_telemetry"

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
    import_batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    compression: Mapped[str] = mapped_column(String(16), nullable=False, default="gzip")
    csv_blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
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
    car_name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    track_name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    driver_name: Mapped[str] = mapped_column(String, nullable=False, default="")
    source_driver_name: Mapped[str | None] = mapped_column(String, nullable=True)
    driver_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    lap_time_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    recorded_at: Mapped[str | None] = mapped_column(String, nullable=True)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    track_length_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    car = relationship("TelemetryCar")
    track = relationship("TelemetryTrack")

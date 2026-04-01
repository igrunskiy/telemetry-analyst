import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AnalysisTelemetryFile(Base):
    __tablename__ = "analysis_telemetry_files"
    __table_args__ = (
        UniqueConstraint("analysis_result_id", "lap_id", name="uq_analysis_telemetry_files_report_lap"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    analysis_result_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analysis_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lap_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    compression: Mapped[str] = mapped_column(String(16), nullable=False, default="gzip")
    csv_blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

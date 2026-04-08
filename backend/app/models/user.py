import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    garage61_user_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    discord_user_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    # Local auth fields
    username: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    # Role and access control
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    is_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    display_name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    access_token_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    refresh_token_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    claude_api_key_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    gemini_api_key_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    openai_api_key_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_login_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

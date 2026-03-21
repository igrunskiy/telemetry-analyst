"""Add enqueued_at to analysis_results

Revision ID: 003
Revises: 001
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysis_results",
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_results", "enqueued_at")

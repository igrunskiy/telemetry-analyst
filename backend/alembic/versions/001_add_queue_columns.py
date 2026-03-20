"""Add queue columns to analysis_results

Revision ID: 001
Revises:
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysis_results",
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
    )
    op.add_column(
        "analysis_results",
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "analysis_results",
        sa.Column("input_json", sa.JSON(), nullable=True),
    )
    op.create_index("ix_analysis_results_status", "analysis_results", ["status"])


def downgrade() -> None:
    op.drop_index("ix_analysis_results_status", table_name="analysis_results")
    op.drop_column("analysis_results", "input_json")
    op.drop_column("analysis_results", "error_message")
    op.drop_column("analysis_results", "status")

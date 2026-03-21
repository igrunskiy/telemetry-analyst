"""Add gemini_api_key_enc to users

Revision ID: 003
Revises: 002
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("gemini_api_key_enc", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "gemini_api_key_enc")

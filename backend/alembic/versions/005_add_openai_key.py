"""Add openai_api_key_enc to users

Revision ID: 005
Revises: 004
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("openai_api_key_enc", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "openai_api_key_enc")

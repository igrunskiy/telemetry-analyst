"""Add Discord auth support

Revision ID: 002
Revises: 001
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add discord_user_id column
    op.add_column("users", sa.Column("discord_user_id", sa.String(), nullable=True))
    op.create_index("ix_users_discord_user_id", "users", ["discord_user_id"], unique=True)

    # Make garage61_user_id and access_token_enc nullable (Discord users won't have these)
    op.alter_column("users", "garage61_user_id", nullable=True)
    op.alter_column("users", "access_token_enc", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "access_token_enc", nullable=False)
    op.alter_column("users", "garage61_user_id", nullable=False)
    op.drop_index("ix_users_discord_user_id", table_name="users")
    op.drop_column("users", "discord_user_id")

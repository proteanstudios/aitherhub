"""
20260225_create_live_sessions

Create live_sessions table for persistent live session management.
Supports both worker-based live_capture sessions and Chrome extension sessions.

Revises: 20260221_product_exposures
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260225_live_sessions"
down_revision = "20260221_product_exposures"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "live_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("video_id", sa.String(255), unique=True, index=True, nullable=False),
        sa.Column("user_id", sa.Integer(), index=True, nullable=False),
        sa.Column("session_type", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("account", sa.String(255), nullable=True),
        sa.Column("live_url", sa.Text(), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("room_id", sa.String(255), nullable=True),
        sa.Column("region", sa.String(50), nullable=True),
        sa.Column("ext_session_id", sa.String(255), nullable=True),
        sa.Column("stream_info", postgresql.JSON(), nullable=True),
        sa.Column("latest_metrics", postgresql.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Index for quickly finding active sessions per user
    op.create_index(
        "ix_live_sessions_user_active",
        "live_sessions",
        ["user_id", "is_active"],
    )


def downgrade():
    op.drop_index("ix_live_sessions_user_active", table_name="live_sessions")
    op.drop_table("live_sessions")

"""add video best and refresh flag

Revision ID: 7ef5d41cf33d
Revises: 9498d5826151
Create Date: 2026-01-22 13:54:20.578691

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7ef5d41cf33d'
down_revision = '9498d5826151'
branch_labels = None
depends_on = None


def upgrade():
    # 1) Add needs_refresh to video_insights
    op.add_column(
        "video_insights",
        sa.Column("needs_refresh", sa.Boolean(), nullable=False, server_default=sa.text("false"))
    )

    # 2) Create video_structure_group_best_videos
    op.create_table(
        "video_structure_group_best_videos",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("group_id", sa.UUID(), sa.ForeignKey("video_structure_groups.id"), nullable=False, unique=True),
        sa.Column("video_id", sa.UUID(), sa.ForeignKey("videos.id"), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade():
    op.drop_table("video_structure_group_best_videos")

    op.drop_column("video_insights", "needs_refresh")
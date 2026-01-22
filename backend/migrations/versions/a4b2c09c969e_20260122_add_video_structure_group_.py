"""
20260122_add_video_structure_group_tables
Revises: c660f1669cd3
Create Date: 2026-01-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a4b2c09c969e"
down_revision = "c660f1669cd3"
branch_labels = None
depends_on = None


def upgrade():
    # =========================================================
    # 1. video_structure_features
    # =========================================================
    op.create_table(
        "video_structure_features",
        sa.Column("video_id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("phase_count", sa.Integer(), nullable=False),
        sa.Column("avg_phase_duration", sa.Float(), nullable=False),
        sa.Column("switch_rate", sa.Float(), nullable=False),

        sa.Column("early_ratio", postgresql.JSONB(), nullable=False),
        sa.Column("mid_ratio", postgresql.JSONB(), nullable=False),
        sa.Column("late_ratio", postgresql.JSONB(), nullable=False),

        sa.Column("structure_embedding", sa.Text(), nullable=True),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # =========================================================
    # 2. video_structure_groups
    # =========================================================
    op.create_table(
        "video_structure_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("structure_embedding", sa.Text(), nullable=True),

        sa.Column("avg_phase_count", sa.Float(), nullable=False),
        sa.Column("avg_phase_duration", sa.Float(), nullable=False),
        sa.Column("avg_switch_rate", sa.Float(), nullable=False),

        sa.Column("early_ratio", postgresql.JSONB(), nullable=False),
        sa.Column("mid_ratio", postgresql.JSONB(), nullable=False),
        sa.Column("late_ratio", postgresql.JSONB(), nullable=False),

        sa.Column("video_count", sa.Integer(), nullable=False, server_default="0"),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # =========================================================
    # 3. video_structure_group_members
    # =========================================================
    op.create_table(
        "video_structure_group_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column("distance", sa.Float(), nullable=True),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),

        sa.ForeignKeyConstraint(["video_id"], ["videos.id"]),
        sa.ForeignKeyConstraint(["group_id"], ["video_structure_groups.id"]),

        sa.UniqueConstraint("video_id", name="uq_video_structure_group_members_video"),
    )

    op.create_index(
        "ix_video_structure_group_members_group_id",
        "video_structure_group_members",
        ["group_id"],
    )


def downgrade():
    op.drop_index(
        "ix_video_structure_group_members_group_id",
        table_name="video_structure_group_members",
    )
    op.drop_table("video_structure_group_members")
    op.drop_table("video_structure_groups")
    op.drop_table("video_structure_features")

"""Create phase V1 tables aligned with pipeline (with video_insights & needs_refresh)

Revision ID: 20260112_create_phase_v1
Revises: 2bb9e5c407cc
Create Date: 2026-01-12

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260112_create_phase_v1"
down_revision = "2bb9e5c407cc"
branch_labels = None
depends_on = None


def upgrade():
    # =========================================================
    # 1. phase_groups
    # =========================================================
    op.create_table(
        "phase_groups",
        sa.Column("id", sa.Integer(), primary_key=True),  # group_id = 1,2,3,...
        sa.Column("centroid", postgresql.JSONB(), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
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
    # 2. video_phases
    # =========================================================
    op.create_table(
        "video_phases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column("phase_index", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("phase_groups.id"), nullable=True),

        sa.Column("phase_description", sa.Text(), nullable=True),

        sa.Column("time_start", sa.Float(), nullable=True),
        sa.Column("time_end", sa.Float(), nullable=True),

        sa.Column("view_start", sa.Integer(), nullable=True),
        sa.Column("view_end", sa.Integer(), nullable=True),
        sa.Column("like_start", sa.Integer(), nullable=True),
        sa.Column("like_end", sa.Integer(), nullable=True),

        sa.Column("delta_view", sa.Integer(), nullable=True),
        sa.Column("delta_like", sa.Integer(), nullable=True),

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

        sa.UniqueConstraint("video_id", "phase_index", name="uq_video_phase_index"),
    )

    op.create_index(
        "ix_video_phases_video_id",
        "video_phases",
        ["video_id"],
    )
    op.create_index(
        "ix_video_phases_group_id",
        "video_phases",
        ["group_id"],
    )

    # =========================================================
    # 3. group_best_phases
    # =========================================================
    op.create_table(
        "group_best_phases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("group_id", sa.Integer(), sa.ForeignKey("phase_groups.id"), nullable=False),

        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("phase_index", sa.Integer(), nullable=False),

        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("view_velocity", sa.Float(), nullable=True),
        sa.Column("like_velocity", sa.Float(), nullable=True),
        sa.Column("like_per_viewer", sa.Float(), nullable=True),

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

        sa.UniqueConstraint("group_id", name="uq_group_best_phases_group_id"),
    )

    op.create_index(
        "ix_group_best_phases_group_id",
        "group_best_phases",
        ["group_id"],
    )

    # =========================================================
    # 4. phase_insights (Report 2) + needs_refresh flag
    # =========================================================
    op.create_table(
        "phase_insights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("phase_index", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=True),

        sa.Column("insight", sa.Text(), nullable=True),

        # NEW: mark insight outdated when best phase changes
        sa.Column(
            "needs_refresh",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),

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

        sa.UniqueConstraint("video_id", "phase_index", name="uq_phase_insights_video_phase"),
    )

    op.create_index(
        "ix_phase_insights_video_id",
        "phase_insights",
        ["video_id"],
    )
    op.create_index(
        "ix_phase_insights_group_id",
        "phase_insights",
        ["group_id"],
    )
    op.create_index(
        "ix_phase_insights_needs_refresh",
        "phase_insights",
        ["needs_refresh"],
    )

    # =========================================================
    # 5. video_insights (Report 3 – video-level insights)
    # =========================================================
    op.create_table(
        "video_insights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),

        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),

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

    op.create_index(
        "ix_video_insights_video_id",
        "video_insights",
        ["video_id"],
    )


def downgrade():
    # Drop video_insights
    op.drop_index("ix_video_insights_video_id", table_name="video_insights")
    op.drop_table("video_insights")

    # Drop phase_insights
    op.drop_index("ix_phase_insights_needs_refresh", table_name="phase_insights")
    op.drop_index("ix_phase_insights_group_id", table_name="phase_insights")
    op.drop_index("ix_phase_insights_video_id", table_name="phase_insights")
    op.drop_table("phase_insights")

    # Drop group_best_phases
    op.drop_index("ix_group_best_phases_group_id", table_name="group_best_phases")
    op.drop_table("group_best_phases")

    # Drop video_phases
    op.drop_index("ix_video_phases_group_id", table_name="video_phases")
    op.drop_index("ix_video_phases_video_id", table_name="video_phases")
    op.drop_table("video_phases")

    # Drop phase_groups
    op.drop_table("phase_groups")

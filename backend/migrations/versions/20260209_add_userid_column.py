"""add user_id columns for user-scoped phase & video grouping

Revision ID: ijkl5678
Revises: abcd1234
Create Date: 2026-02-09
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "ijkl5678"
down_revision = "abcd1234"
branch_labels = None
depends_on = None


def upgrade():

    op.add_column("phase_groups", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column("video_phases", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column("group_best_phases", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column("phase_insights", sa.Column("user_id", sa.Integer(), nullable=True))


    op.add_column(
        "video_structure_group_members",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "video_structure_groups",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "video_structure_group_best_videos",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )


    op.add_column("video_insights", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column(
        "video_structure_features",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )

    op.create_index("idx_phase_groups_user_id", "phase_groups", ["user_id"])
    op.create_index("idx_video_phases_user_id", "video_phases", ["user_id"])
    op.create_index(
        "idx_group_best_phases_user_group",
        "group_best_phases",
        ["user_id", "group_id"],
    )
    op.create_index(
        "idx_phase_insights_user_video",
        "phase_insights",
        ["user_id", "video_id"],
    )

    op.create_index(
        "idx_vsgm_user_group",
        "video_structure_group_members",
        ["user_id", "group_id"],
    )
    op.create_index(
        "idx_vsg_user_id",
        "video_structure_groups",
        ["user_id"],
    )
    op.create_index(
        "idx_vsgbv_user_group",
        "video_structure_group_best_videos",
        ["user_id", "group_id"],
    )

    op.create_index(
        "idx_video_insights_user_video",
        "video_insights",
        ["user_id", "video_id"],
    )
    op.create_index(
        "idx_vsf_user_video",
        "video_structure_features",
        ["user_id", "video_id"],
    )


def downgrade():
    # drop indexes
    op.drop_index("idx_vsf_user_video", table_name="video_structure_features")
    op.drop_index("idx_video_insights_user_video", table_name="video_insights")
    op.drop_index(
        "idx_vsgbv_user_group",
        table_name="video_structure_group_best_videos",
    )
    op.drop_index("idx_vsg_user_id", table_name="video_structure_groups")
    op.drop_index(
        "idx_vsgm_user_group",
        table_name="video_structure_group_members",
    )
    op.drop_index(
        "idx_phase_insights_user_video",
        table_name="phase_insights",
    )
    op.drop_index(
        "idx_group_best_phases_user_group",
        table_name="group_best_phases",
    )
    op.drop_index("idx_video_phases_user_id", table_name="video_phases")
    op.drop_index("idx_phase_groups_user_id", table_name="phase_groups")

    op.drop_column("video_structure_features", "user_id")
    op.drop_column("video_insights", "user_id")
    op.drop_column("video_structure_group_best_videos", "user_id")
    op.drop_column("video_structure_groups", "user_id")
    op.drop_column("video_structure_group_members", "user_id")
    op.drop_column("phase_insights", "user_id")
    op.drop_column("group_best_phases", "user_id")
    op.drop_column("video_phases", "user_id")
    op.drop_column("phase_groups", "user_id")

"""add user_rating and user_comment columns to video_phases

Revision ID: 20260219_user_rating
Revises: 20260219_video_clips
Create Date: 2026-02-19
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260219_user_rating"
down_revision = "20260219_video_clips"
branch_labels = None
depends_on = None


def upgrade():
    # Add user_rating column (1-5 scale, nullable)
    op.add_column(
        'video_phases',
        sa.Column('user_rating', sa.Integer(), nullable=True)
    )

    # Add user_comment column (free text, nullable)
    op.add_column(
        'video_phases',
        sa.Column('user_comment', sa.Text(), nullable=True)
    )

    # Add rated_at timestamp
    op.add_column(
        'video_phases',
        sa.Column('rated_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade():
    op.drop_column('video_phases', 'rated_at')
    op.drop_column('video_phases', 'user_comment')
    op.drop_column('video_phases', 'user_rating')

"""add upload_type to videos

Revision ID: 20260217_upload_type
Revises: g1h2i3j4
Create Date: 2026-02-17 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260217_upload_type'
down_revision = 'g1h2i3j4'
branch_labels = None
depends_on = None


def upgrade():
    # Add upload_type column to videos table
    # Values: 'screen_recording' (default, existing behavior) or 'clean_video'
    op.add_column(
        'videos',
        sa.Column('upload_type', sa.String(50), nullable=False, server_default='screen_recording')
    )
    # Add excel_product_blob_url and excel_trend_blob_url for clean_video uploads
    op.add_column(
        'videos',
        sa.Column('excel_product_blob_url', sa.Text(), nullable=True)
    )
    op.add_column(
        'videos',
        sa.Column('excel_trend_blob_url', sa.Text(), nullable=True)
    )


def downgrade():
    op.drop_column('videos', 'excel_trend_blob_url')
    op.drop_column('videos', 'excel_product_blob_url')
    op.drop_column('videos', 'upload_type')

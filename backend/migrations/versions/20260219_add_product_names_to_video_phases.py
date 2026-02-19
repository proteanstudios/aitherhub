"""add product_names column to video_phases

Revision ID: 20260219_product_names
Revises: 20260218_upload_type
Create Date: 2026-02-19 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260219_product_names'
down_revision = '20260218_upload_type'
branch_labels = None
depends_on = None


def upgrade():
    # Add product_names column to video_phases table
    # Stores JSON array of product names sold during this phase
    # e.g. '["商品A", "商品B"]'
    op.add_column(
        'video_phases',
        sa.Column('product_names', sa.Text(), nullable=True)
    )


def downgrade():
    op.drop_column('video_phases', 'product_names')

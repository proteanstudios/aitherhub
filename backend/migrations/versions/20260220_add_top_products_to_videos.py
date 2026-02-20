"""add top_products column to videos

Revision ID: 20260220_top_products
Revises: 20260220_compressed_blob
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260220_top_products"
down_revision = "20260220_compressed_blob"
branch_labels = None
depends_on = None


def upgrade():
    # Add top_products column to cache GMV top 2 product names as JSON string
    # e.g., '["モイストシャンプー&トリートメントセット", "ボディウォッシュ250ml"]'
    op.add_column(
        "videos",
        sa.Column("top_products", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("videos", "top_products")

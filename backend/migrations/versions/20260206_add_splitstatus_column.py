"""add split_status to videos

Revision ID: abcd1234
Revises: f2c3a4b5d6e7
Create Date: 2026-02-06
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "abcd1234"
down_revision = "f2c3a4b5d6e7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "videos",
        sa.Column("split_status", sa.String(length=32), nullable=True)
    )


def downgrade():
    op.drop_column("videos", "split_status")

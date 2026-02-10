"""add created_at and updated_at columns to uploads

Revision ID: qrst3456
Revises: mnop9012
Create Date: 2026-02-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "qrst3456"
down_revision = "mnop9012"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_context().bind)
    columns = [c["name"] for c in inspector.get_columns("uploads")]

    if "created_at" not in columns:
        op.add_column(
            "uploads",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    if "updated_at" not in columns:
        op.add_column(
            "uploads",
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )


def downgrade():
    inspector = inspect(op.get_context().bind)
    columns = [c["name"] for c in inspector.get_columns("uploads")]

    if "updated_at" in columns:
        op.drop_column("uploads", "updated_at")
    if "created_at" in columns:
        op.drop_column("uploads", "created_at")


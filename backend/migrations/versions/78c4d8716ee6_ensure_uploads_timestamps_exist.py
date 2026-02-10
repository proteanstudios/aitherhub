"""ensure uploads timestamps exist

Revision ID: 78c4d8716ee6
Revises: 4642d4e8
Create Date: 2026-02-10 14:03:49.014742

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '78c4d8716ee6'
down_revision = '4642d4e8'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

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
    conn = op.get_bind()
    inspector = inspect(conn)

    columns = [c["name"] for c in inspector.get_columns("uploads")]

    if "updated_at" in columns:
        op.drop_column("uploads", "updated_at")
    if "created_at" in columns:
        op.drop_column("uploads", "created_at")

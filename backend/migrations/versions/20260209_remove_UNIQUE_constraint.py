"""drop unique constraint uq_group_best_phases_group_id

Revision ID: 4642d4e8
Revises: qrst3456
Create Date: 2026-02-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "4642d4e8"
down_revision = "qrst3456"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    # Drop the UNIQUE constraint on group_id if it exists (name may differ across environments).
    for uq in inspector.get_unique_constraints("group_best_phases"):
        name = uq.get("name")
        cols = uq.get("column_names") or []
        if name and cols == ["group_id"]:
            op.drop_constraint(name, "group_best_phases", type_="unique")
            return

    # Fallback for legacy naming (PostgreSQL-specific, safe no-op if missing).
    op.execute(
        sa.text(
            "ALTER TABLE group_best_phases DROP CONSTRAINT IF EXISTS uq_group_best_phases_group_id"
        )
    )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    # Only recreate if there isn't already a UNIQUE constraint on group_id.
    has_uq_on_group_id = any(
        (uq.get("column_names") or []) == ["group_id"]
        for uq in inspector.get_unique_constraints("group_best_phases")
    )
    if not has_uq_on_group_id:
        op.create_unique_constraint(
            "uq_group_best_phases_group_id",
            "group_best_phases",
            ["group_id"],
        )

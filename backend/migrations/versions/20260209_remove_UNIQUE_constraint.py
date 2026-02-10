"""drop unique constraint uq_group_best_phases_group_id

Revision ID: mnop9012
Revises: ijkl5678
Create Date: 2026-02-09
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "mnop9012"
down_revision = "ijkl5678"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        "uq_group_best_phases_group_id",
        "group_best_phases",
        type_="unique",
    )


def downgrade():
    op.create_unique_constraint(
        "uq_group_best_phases_group_id",
        "group_best_phases",
        ["group_id"],
    )

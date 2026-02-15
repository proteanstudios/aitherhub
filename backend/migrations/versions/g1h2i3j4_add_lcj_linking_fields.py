"""Add LCJ linking fields to users table

Revision ID: g1h2i3j4
Revises: mnop9012
Create Date: 2026-02-15 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "g1h2i3j4"
down_revision = "3ce20344bb0b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("lcj_liver_email", sa.String(320), nullable=True))
    op.add_column("users", sa.Column("lcj_liver_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("lcj_linked_at", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "lcj_linked_at")
    op.drop_column("users", "lcj_liver_name")
    op.drop_column("users", "lcj_liver_email")

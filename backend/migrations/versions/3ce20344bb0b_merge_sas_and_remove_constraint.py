"""merge sas and remove constraint

Revision ID: 3ce20344bb0b
Revises: abcd123456, ruc_20260210
Create Date: 2026-02-10 18:07:32.258591

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3ce20344bb0b'
down_revision = ('abcd123456', 'ruc_20260210')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass

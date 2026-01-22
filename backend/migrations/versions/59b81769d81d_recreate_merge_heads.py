"""recreate merge heads

Revision ID: 59b81769d81d
Revises: 20260112_create_phase_v1, 20260119_add_chats_table
Create Date: 2026-01-22 10:21:52.535453

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c660f1669cd3'
down_revision = ('20260112_create_phase_v1', '20260119_add_chats_table')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass

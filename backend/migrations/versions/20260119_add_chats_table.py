"""Add chats table

Revision ID: 20260119_add_chats_table
Revises: ff243f94d1a3
Create Date: 2026-01-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '20260119_add_chats_table'
down_revision = 'ff243f94d1a3'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'chats',
        sa.Column('video_id', postgresql.UUID(), nullable=False),
        sa.Column('question', sa.Text(), nullable=True),
        sa.Column('answer', sa.Text(), nullable=True),
        sa.Column('id', postgresql.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade():
    op.drop_table('chats')

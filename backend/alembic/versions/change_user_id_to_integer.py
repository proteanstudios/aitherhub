"""change user id from uuid to integer

Revision ID: change_user_id_int
Revises: 282b38e7e9f1
Create Date: 2024-12-29 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'change_user_id_int'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop foreign key constraints first
    op.drop_constraint('credentials_user_id_fkey', 'credentials', type_='foreignkey')
    op.drop_constraint('videos_user_id_fkey', 'videos', type_='foreignkey')
    
    # Add new integer id column
    op.add_column('users', sa.Column('id_new', sa.Integer(), nullable=True, autoincrement=True))
    
    # Populate new id column with sequential numbers using CTE
    op.execute("""
        WITH numbered_users AS (
            SELECT id, row_number() OVER (ORDER BY created_at) as rn
            FROM users
        )
        UPDATE users u
        SET id_new = nu.rn
        FROM numbered_users nu
        WHERE u.id = nu.id
    """)
    
    # Make id_new NOT NULL
    op.alter_column('users', 'id_new', nullable=False)
    
    # Update foreign keys in related tables
    op.add_column('credentials', sa.Column('user_id_new', sa.Integer(), nullable=True))
    op.add_column('videos', sa.Column('user_id_new', sa.Integer(), nullable=True))
    
    op.execute("""
        UPDATE credentials c
        SET user_id_new = u.id_new
        FROM users u
        WHERE c.user_id::text = u.id::text
    """)
    
    op.execute("""
        UPDATE videos v
        SET user_id_new = u.id_new
        FROM users u
        WHERE v.user_id::text = u.id::text
    """)
    
    # Drop old columns
    op.drop_column('credentials', 'user_id')
    op.drop_column('videos', 'user_id')
    op.drop_column('users', 'id')
    
    # Rename new columns
    op.rename_column('users', 'id_new', 'id')
    op.rename_column('credentials', 'user_id_new', 'user_id')
    op.rename_column('videos', 'user_id_new', 'user_id')
    
    # Set primary key
    op.create_primary_key('users_pkey', 'users', ['id'])
    
    # Create sequence for auto-increment
    op.execute("CREATE SEQUENCE IF NOT EXISTS users_id_seq OWNED BY users.id")
    op.execute("ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq')")
    op.execute("SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1))")
    
    # Recreate foreign key constraints
    op.create_foreign_key('credentials_user_id_fkey', 'credentials', 'users', ['user_id'], ['id'])
    op.create_foreign_key('videos_user_id_fkey', 'videos', 'users', ['user_id'], ['id'])
    
    # Make foreign keys NOT NULL
    op.alter_column('credentials', 'user_id', nullable=False)


def downgrade() -> None:
    # This is a complex downgrade - would need to restore UUIDs
    # For now, we'll just note that downgrade is not fully supported
    pass


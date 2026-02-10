from alembic import op


revision = "qrst3456"
down_revision = "mnop9012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE group_best_phases
        DROP CONSTRAINT IF EXISTS group_best_phases_group_id_fkey;
    """)

    op.execute("""
        ALTER TABLE group_best_phases
        DROP CONSTRAINT IF EXISTS uq_group_best_phases_group_id;
    """)

    op.execute("""
        ALTER TABLE group_best_phases
        DROP CONSTRAINT IF EXISTS group_best_phases_pkey;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE group_best_phases
        ADD CONSTRAINT group_best_phases_pkey
        PRIMARY KEY (id);
    """)

    op.execute("""
        ALTER TABLE group_best_phases
        ADD CONSTRAINT uq_group_best_phases_group_id
        UNIQUE (group_id);
    """)

    op.execute("""
        ALTER TABLE group_best_phases
        ADD CONSTRAINT group_best_phases_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES phase_groups(id);
    """)

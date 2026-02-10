from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "abcd123456"
down_revision = "78c4d8716ee6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "video_phases",
        sa.Column("sas_token", sa.Text(), nullable=True),
    )

    op.add_column(
        "video_phases",
        sa.Column("sas_expireddate", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("video_phases", "sas_expireddate")
    op.drop_column("video_phases", "sas_token")

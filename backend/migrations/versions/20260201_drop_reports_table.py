

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "9498d5826151"
down_revision = "a4b2c09c969e"
branch_labels = None
depends_on = None


def upgrade():
    # Drop bảng nếu tồn tại
    op.drop_table("reports", if_exists=True)


def downgrade():
    # Nếu muốn rollback thì recreate lại bảng.
    # Không bắt buộc, nhưng để đây cho đầy đủ.
    op.create_table(
        "reports",
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("report_content", sa.Text(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

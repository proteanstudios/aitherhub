"""add uploads resumable fields

Revision ID: f2c3a4b5d6e7
Revises: 9498d5826151
Create Date: 2026-02-02 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f2c3a4b5d6e7"
down_revision = "7ef5d41cf33d"
branch_labels = None
depends_on = None


def upgrade():
    # Add upload_url column if it doesn't exist
    from sqlalchemy import inspect, MetaData, Table
    
    # Check if columns exist before adding
    inspector = inspect(op.get_context().bind)
    columns = [c['name'] for c in inspector.get_columns('uploads')]
    
    if 'user_id' not in columns:
        op.add_column(
            "uploads",
            sa.Column("user_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_uploads_user_id_users",
            "uploads",
            "users",
            ["user_id"],
            ["id"],
        )
    
    if 'upload_url' not in columns:
        op.add_column(
            "uploads",
            sa.Column("upload_url", sa.Text(), nullable=True),
        )
    
    # Drop video_id if it exists
    if 'video_id' in columns:
        op.drop_column("uploads", "video_id")
    
    # Drop all unnecessary columns
    columns_to_drop = [
        "total_chunks",
        "uploaded_chunks", 
        "status",
        "blob_name",
        "expires_at",
        "block_size",
        "block_count",
        "meta",
        "started_at",
        "completed_at",
    ]
    
    inspector = inspect(op.get_context().bind)
    existing_columns = [c['name'] for c in inspector.get_columns('uploads')]
    
    for column in columns_to_drop:
        if column in existing_columns:
            op.drop_column("uploads", column)
    
    # Create index for user_id if it doesn't exist
    inspector = inspect(op.get_context().bind)
    indexes = [idx['name'] for idx in inspector.get_indexes('uploads')]
    if 'ix_uploads_user_id' not in indexes:
        op.create_index(op.f("ix_uploads_user_id"), "uploads", ["user_id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_uploads_user_id"), table_name="uploads")

    op.drop_column("uploads", "upload_url")

    op.drop_constraint("fk_uploads_user_id_users", "uploads", type_="foreignkey")
    op.drop_column("uploads", "user_id")

    # Recreate the video_id column (nullable) and its FK on downgrade
    op.add_column(
        "uploads",
        sa.Column("video_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_uploads_video_id_videos",
        "uploads",
        "videos",
        ["video_id"],
        ["id"],
    )

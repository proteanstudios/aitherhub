from logging.config import fileConfig
from alembic import context
from sqlalchemy import create_engine, pool
import os

from app.models.orm.base import Base

# Import all models to register them with SQLAlchemy
from app.models.orm import (
    User,
    Credential,
    Video,
    Upload,
    ProcessingJob,
    VideoFrame,
    FrameAnalysisResult,
    AudioChunk,
    SpeechSegment,
    VideoProcessingState,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url():
    # Get DATABASE_URL from environment
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable is not set")
    
    # Convert asyncpg URL to psycopg2 URL for Alembic (sync operations)
    # postgresql+asyncpg:// -> postgresql+psycopg2://
    if database_url.startswith("postgresql+asyncpg://"):
        database_url = database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    elif database_url.startswith("postgresql://"):
        # If it's just postgresql://, add psycopg2
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://")
    
    return database_url


def run_migrations_offline():
    """Run migrations in 'offline' mode."""
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode."""
    url = get_url()
    connectable = create_engine(
        url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

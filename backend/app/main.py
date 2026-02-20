import logging
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.api.v1.routes import routers as v1_routers
from app.core.config import configs
from app.core.container import Container
from app.utils.class_object import singleton

logger = logging.getLogger(__name__)

@singleton
class AppCreator:
    def __init__(self):
        # Init FastAPI
        self.app = FastAPI(
            title=configs.PROJECT_NAME,
            version="0.0.1",
            openapi_url=f"{configs.API_V1_STR}/openapi.json",
        )

        # Init DI container & DB
        self.container = Container()
        self.container.wire(modules=[__name__])
        self.db = self.container.db()
        # self.db.create_database()

        # CORS
        if configs.BACKEND_CORS_ORIGINS:
            self.app.add_middleware(
                CORSMiddleware,
                allow_origins=[str(origin) for origin in configs.BACKEND_CORS_ORIGINS],
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )

        # Run safe migrations on startup
        @self.app.on_event("startup")
        async def run_safe_migrations():
            """Add missing columns to database tables (idempotent, safe to run repeatedly)."""
            from app.core.database import get_db
            try:
                async for db in get_db():
                    from sqlalchemy import text
                    # Add compressed_blob_url column if it doesn't exist
                    await db.execute(text("""
                        DO $$
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns
                                WHERE table_name = 'videos' AND column_name = 'compressed_blob_url'
                            ) THEN
                                ALTER TABLE videos ADD COLUMN compressed_blob_url TEXT;
                            END IF;
                        END $$;
                    """))
                    await db.commit()
                    logger.info("Safe migration check completed: compressed_blob_url column ensured")
            except Exception as e:
                logger.warning(f"Safe migration check failed (non-fatal): {e}")

        # Health check
        @self.app.get("/")
        async def root():
            return {"status": "service is working"}

        # API v1 routes
        self.app.include_router(
            v1_routers,
            prefix=configs.API_V1_STR,
        )


app_creator = AppCreator()
app = app_creator.app
db = app_creator.db
container = app_creator.container

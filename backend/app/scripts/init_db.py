import asyncio
from app.core.db import engine
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


async def init():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


if __name__ == "__main__":
    asyncio.run(init())

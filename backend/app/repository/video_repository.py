from contextlib import AbstractContextManager
from typing import Callable
import uuid as _uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.models.orm.video import Video
from app.repository.base_repository import BaseRepository


class VideoRepository(BaseRepository):
    def __init__(self, session_factory: Callable[..., AsyncSession]):
        self.session_factory = session_factory
        super().__init__(session_factory, Video)

    async def create_video(self, user_id: int, video_id: str, original_filename: str, status: str = "uploaded") -> Video:
        """Create a new video record"""
        session = self.session_factory()
        try:
            video = Video(
                id=_uuid.UUID(video_id),
                user_id=user_id,
                original_filename=original_filename,
                status=status,
            )
            session.add(video)
            await session.commit()
            await session.refresh(video)
            return video
        finally:
            await session.close()

    async def get_video_by_id(self, video_id: str) -> Video | None:
        """Get video by ID"""
        session = self.session_factory()
        try:
            result = await session.execute(
                select(Video).filter(Video.id == _uuid.UUID(video_id))
            )
            return result.scalar_one_or_none()
        finally:
            await session.close()

    async def get_videos_by_user(self, user_id: int) -> list[Video]:
        """Get all videos for a user"""
        session = self.session_factory()
        try:
            result = await session.execute(
                select(Video).filter(Video.user_id == user_id)
                .order_by(desc(Video.created_at))
            )
            return result.scalars().all()
        finally:
            await session.close()

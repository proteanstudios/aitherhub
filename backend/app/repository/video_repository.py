from contextlib import AbstractContextManager
from typing import Callable
import uuid as _uuid

from sqlalchemy.orm import Session

from app.models.orm.video import Video
from app.repository.base_repository import BaseRepository


class VideoRepository(BaseRepository):
    def __init__(self, session_factory: Callable[..., AbstractContextManager[Session]]):
        self.session_factory = session_factory
        super().__init__(session_factory, Video)

    def create_video(self, user_id: int, video_id: str, original_filename: str, status: str = "uploaded") -> Video:
        """Create a new video record"""
        with self.session_factory() as session:
            video = Video(
                id=_uuid.UUID(video_id),
                user_id=user_id,
                original_filename=original_filename,
                status=status,
            )
            session.add(video)
            session.commit()
            session.refresh(video)
            return video

    def get_video_by_id(self, video_id: str) -> Video | None:
        """Get video by ID"""
        with self.session_factory() as session:
            return session.query(Video).filter(Video.id == _uuid.UUID(video_id)).first()

    def get_videos_by_user(self, user_id: int) -> list[Video]:
        """Get all videos for a user"""
        with self.session_factory() as session:
            return session.query(Video).filter(Video.user_id == user_id).all()

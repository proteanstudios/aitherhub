# app/models/orm/video_frame.py
from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class VideoFrame(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "video_frames"

    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))
    frame_index: Mapped[int]
    timestamp_ms: Mapped[int]

    blob_url: Mapped[str] = mapped_column(Text)
    width: Mapped[int]
    height: Mapped[int]

# app/models/orm/video_state.py
from sqlalchemy import ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base


class VideoProcessingState(Base):
    __tablename__ = "video_processing_state"

    video_id: Mapped[str] = mapped_column(
        ForeignKey("videos.id"),
        primary_key=True
    )

    frames_extracted: Mapped[bool] = mapped_column(Boolean, default=False)
    audio_extracted: Mapped[bool] = mapped_column(Boolean, default=False)
    speech_done: Mapped[bool] = mapped_column(Boolean, default=False)
    vision_done: Mapped[bool] = mapped_column(Boolean, default=False)

    updated_at: Mapped

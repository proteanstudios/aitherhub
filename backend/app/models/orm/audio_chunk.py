# app/models/orm/audio_chunk.py
from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class AudioChunk(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "audio_chunks"

    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))
    chunk_index: Mapped[int]

    start_ms: Mapped[int]
    end_ms: Mapped[int]
    duration_ms: Mapped[int]

    blob_url: Mapped[str] = mapped_column(Text)

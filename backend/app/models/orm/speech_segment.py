# app/models/orm/speech_segment.py
from sqlalchemy import ForeignKey, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class SpeechSegment(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "speech_segments"

    audio_chunk_id: Mapped[str] = mapped_column(ForeignKey("audio_chunks.id"))
    start_ms: Mapped[int]
    end_ms: Mapped[int]

    text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float]

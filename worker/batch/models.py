# worker/src/models.py
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    Integer,
    Text,
    Float,
    DateTime,
    ForeignKey,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func


# ---------- Base ----------
class Base(DeclarativeBase):
    pass


# ---------- processing_jobs ----------
class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id")
    )

    job_type: Mapped[str]
    status: Mapped[str]

    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    error_message: Mapped[str | None] = mapped_column(Text)


# ---------- video_processing_state ----------
class VideoProcessingState(Base):
    __tablename__ = "video_processing_state"

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("videos.id"),
        primary_key=True,
    )

    frames_extracted: Mapped[bool] = mapped_column(Boolean, default=False)
    audio_extracted: Mapped[bool] = mapped_column(Boolean, default=False)
    speech_done: Mapped[bool] = mapped_column(Boolean, default=False)
    vision_done: Mapped[bool] = mapped_column(Boolean, default=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


# ---------- video_frames ----------
class VideoFrame(Base):
    __tablename__ = "video_frames"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id")
    )

    frame_index: Mapped[int]
    timestamp_ms: Mapped[int]

    blob_url: Mapped[str] = mapped_column(Text)
    width: Mapped[int]
    height: Mapped[int]

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


# ---------- frame_analysis_results ----------
class FrameAnalysisResult(Base):
    __tablename__ = "frame_analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    frame_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_frames.id")
    )

    analysis_type: Mapped[str]
    result: Mapped[dict] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


# ---------- audio_chunks ----------
class AudioChunk(Base):
    __tablename__ = "audio_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id")
    )

    chunk_index: Mapped[int]
    start_ms: Mapped[int]
    end_ms: Mapped[int]
    duration_ms: Mapped[int]

    blob_url: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


# ---------- speech_segments ----------
class SpeechSegment(Base):
    __tablename__ = "speech_segments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    audio_chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audio_chunks.id")
    )

    start_ms: Mapped[int]
    end_ms: Mapped[int]

    text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float]

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

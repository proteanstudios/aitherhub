# app/models/orm/frame_analysis.py
from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class FrameAnalysisResult(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "frame_analysis_results"

    frame_id: Mapped[str] = mapped_column(ForeignKey("video_frames.id"))
    analysis_type: Mapped[str]
    result: Mapped[dict] = mapped_column(JSONB)

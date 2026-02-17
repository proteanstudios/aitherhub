# app/models/orm/video.py
from sqlalchemy import ForeignKey, Text, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin
from typing import Optional


class Video(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "videos"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))

    original_filename: Mapped[str | None]

    status: Mapped[str]

    # Upload type: 'screen_recording' (default) or 'clean_video'
    upload_type: Mapped[str] = mapped_column(
        String(50), default="screen_recording", server_default="screen_recording"
    )

    # Excel file blob URLs (only for clean_video uploads)
    excel_product_blob_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    excel_trend_blob_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

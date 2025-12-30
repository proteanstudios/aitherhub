# app/models/orm/upload.py
from datetime import datetime
from sqlalchemy import Integer

from sqlalchemy import ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.models.orm.base import Base, UUIDMixin


class Upload(Base, UUIDMixin):
    __tablename__ = "uploads"

    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))

    total_chunks: Mapped[int] = mapped_column(Integer)
    uploaded_chunks: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column()

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

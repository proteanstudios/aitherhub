# app/models/orm/upload.py
from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin


class Upload(Base, UUIDMixin):
    __tablename__ = "uploads"

    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))
    total_chunks: Mapped[int]
    uploaded_chunks: Mapped[int]
    status: Mapped[str]

    started_at: Mapped | None
    completed_at: Mapped | None

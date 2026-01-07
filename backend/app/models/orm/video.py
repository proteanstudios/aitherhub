# app/models/orm/video.py
from sqlalchemy import ForeignKey, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class Video(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "videos"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))

    original_filename: Mapped[str | None]

    status: Mapped[str]

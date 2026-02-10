# app/models/orm/upload.py
from sqlalchemy import Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class Upload(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "uploads"

    # Optional association to a user who initiated the upload
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Upload URL for resumable upload
    upload_url: Mapped[str | None] = mapped_column(Text, nullable=True)


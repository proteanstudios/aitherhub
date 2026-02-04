# app/models/orm/upload.py
from datetime import datetime
import uuid
from sqlalchemy import Integer, Text, ForeignKey
from sqlalchemy import DateTime as SADateTime
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.orm.base import Base, UUIDMixin


class Upload(Base, UUIDMixin):
    __tablename__ = "uploads"

    # Optional association to a user who initiated the upload
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Upload URL for resumable upload
    upload_url: Mapped[str | None] = mapped_column(Text, nullable=True)


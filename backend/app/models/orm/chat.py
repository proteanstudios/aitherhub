from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class Chat(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "chats"

    # Reference to videos.id (UUID)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))

    question: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)

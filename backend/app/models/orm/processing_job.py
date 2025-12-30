from datetime import datetime

from sqlalchemy import ForeignKey, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.models.orm.base import Base, UUIDMixin


class ProcessingJob(Base, UUIDMixin):
    __tablename__ = "processing_jobs"

    video_id: Mapped[str] = mapped_column(
        ForeignKey("videos.id"), nullable=False
    )

    job_type: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(nullable=False)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

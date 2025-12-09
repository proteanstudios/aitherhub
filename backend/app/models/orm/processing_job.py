# app/models/orm/processing_job.py
from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin


class ProcessingJob(Base, UUIDMixin):
    __tablename__ = "processing_jobs"

    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))
    job_type: Mapped[str]
    status: Mapped[str]

    started_at: Mapped | None
    finished_at: Mapped | None
    error_message: Mapped[str | None] = mapped_column(Text)

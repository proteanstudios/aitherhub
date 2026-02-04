from app.services.storage_service import generate_upload_sas, generate_download_sas, generate_blob_name
from app.repository.video_repository import VideoRepository
from app.services.queue_service import enqueue_job
from app.core.container import Container
from app.models.orm.upload import Upload
from app.models.orm.user import User
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
import os
import asyncio
import uuid as uuid_module


class VideoService:
    """Service layer for video operations"""

    def __init__(self, video_repository: VideoRepository | None = None):
        self.video_repository = video_repository

    async def generate_upload_url(self, email: str, db: AsyncSession, video_id: str | None = None, filename: str | None = None):
        """Generate SAS upload URL for video file and create Upload record for resumable uploads"""
        vid, upload_url, blob_url, expiry = await generate_upload_sas(
            email=email,
            video_id=video_id,
            filename=filename,
        )
        
        # Find user by email
        user_id = None
        try:
            result = await db.execute(
                select(User).where(User.email == email)
            )
            user = result.scalar_one_or_none()
            if user:
                user_id = user.id
        except Exception:
            # If user lookup fails, continue with user_id=None
            pass
        
        # Create Upload record for tracking resumable session
        upload_id = str(uuid_module.uuid4())
        
        upload_record = Upload(
            id=uuid_module.UUID(upload_id),
            user_id=user_id,
            upload_url=upload_url,
        )
        
        db.add(upload_record)
        await db.commit()

        return {
            "video_id": vid,
            "upload_id": upload_id,
            "upload_url": upload_url,
            "blob_url": blob_url,
            "expires_at": expiry,
        }

    async def generate_download_url(self, email: str, video_id: str, filename: str | None = None, expires_in_minutes: int | None = None):
        """Generate SAS download URL for video file"""
        download_url, expiry = await generate_download_sas(
            email=email,
            video_id=video_id,
            filename=filename,
            expires_in_minutes=expires_in_minutes,
        )
        return {
            "video_id": video_id,
            "download_url": download_url,
            "expires_at": expiry,
        }

    async def handle_upload(self, db, blob_url):
        """Handle video upload completion"""
        # TODO: create job in database and enqueue for processing
        # from app.repositories.video_repo import create_job
        # from app.services.queue_service import enqueue_job
        # job_id = "uuid_here"
        # await create_job(db, job_id, blob_url)
        # await enqueue_job(blob_url, job_id)
        # return job_id
        pass

    async def handle_upload_complete(self, user_id: int, email: str, video_id: str, original_filename: str, db: AsyncSession, upload_id: str | None = None) -> dict:
        """Handle video upload completion - save to database and remove upload session"""
        if not self.video_repository:
            raise RuntimeError("VideoRepository not initialized")
        
        # 1) Persist video record (status=uploaded)
        video = await self.video_repository.create_video(
            user_id=user_id,
            video_id=video_id,
            original_filename=original_filename,
            status="uploaded",
        )

        # 2) Generate download SAS URL so worker can fetch the video
        download_url, _ = await generate_download_sas(
            email=email,
            video_id=str(video.id),
            filename=original_filename,
            expires_in_minutes=1440,  # 24h for processing
        )

        # 3) Enqueue a message so worker can start processing
        await enqueue_job({
            "video_id": str(video.id),
            "blob_url": download_url,  # SAS URL with read permission
            "original_filename": original_filename,
            "user_id": user_id,
        })

        # Remove upload session record if present
        if upload_id:
            try:
                from uuid import UUID as _UUID
                upload_uuid = _UUID(upload_id)
                await db.execute(
                    delete(Upload).where(Upload.id == upload_uuid)
                )
                await db.commit()
            except Exception:
                # ignore failures to delete upload record
                pass

        return {
            "video_id": str(video.id),
            "status": video.status,
            "message": "Video upload completed; queued for analysis",
        }


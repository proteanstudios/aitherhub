from app.services.storage_service import generate_upload_sas, generate_download_sas
from app.repository.video_repository import VideoRepository


class VideoService:
    """Service layer for video operations"""

    def __init__(self, video_repository: VideoRepository | None = None):
        self.video_repository = video_repository

    async def generate_upload_url(self, email: str, video_id: str | None = None, filename: str | None = None):
        """Generate SAS upload URL for video file"""
        vid, upload_url, blob_url, expiry = await generate_upload_sas(
            email=email,
            video_id=video_id,
            filename=filename,
        )
        return {
            "video_id": vid,
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

    async def handle_upload_complete(self, user_id: int, video_id: str, original_filename: str) -> dict:
        """Handle video upload completion - save to database"""
        if not self.video_repository:
            raise RuntimeError("VideoRepository not initialized")
        
        video = self.video_repository.create_video(
            user_id=user_id,
            video_id=video_id,
            original_filename=original_filename,
            status="uploaded",
        )
        
        return {
            "video_id": str(video.id),
            "status": video.status,
            "message": "Video upload completed successfully",
        }


from app.services.storage_service import generate_upload_sas


class VideoService:
    """Service layer for video operations"""

    async def generate_upload_url(self, video_id: str | None = None, filename: str | None = None):
        """Generate SAS upload URL for video file"""
        vid, upload_url, blob_url, expiry = await generate_upload_sas(
            video_id=video_id,
            filename=filename,
        )
        return {
            "video_id": vid,
            "upload_url": upload_url,
            "blob_url": blob_url,
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

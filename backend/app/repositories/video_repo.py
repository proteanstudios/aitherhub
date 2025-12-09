from sqlalchemy.ext.asyncio import AsyncSession
from app.models.orm import VideoJob

async def create_job(
    db: AsyncSession,
    job_id: str,
    blob_url: str
):
    job = VideoJob(
        id=job_id,
        blob_url=blob_url,
        status="queued"
    )
    db.add(job)
    await db.commit()
    return job


async def update_status(
    db: AsyncSession,
    job_id: str,
    status: str
):
    job = await db.get(VideoJob, job_id)
    job.status = status
    await db.commit()

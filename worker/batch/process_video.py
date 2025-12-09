from sqlalchemy import update
from batch.db_client import AsyncSessionLocal
from batch.models import VideoJob


async def update_status(job_id: str, status: str):
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(VideoJob)
            .where(VideoJob.id == job_id)
            .values(status=status)
        )
        await session.commit()

from app.repository.video_repo import create_job
from app.services.queue_service import enqueue_job

async def handle_upload(db, blob_url):
    job_id = "uuid_here"

    await create_job(db, job_id, blob_url)
    await enqueue_job(blob_url, job_id)

    return job_id

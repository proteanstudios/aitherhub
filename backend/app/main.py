from fastapi import FastAPI, UploadFile
from app.services.storage_service import upload_to_blob
from app.services.queue_service import enqueue_job

app = FastAPI()

@app.post("/videos/upload")
async def upload_video(file: UploadFile):
    blob_url = await upload_to_blob(file)
    
    job_id = await enqueue_job(blob_url)
    
    return {"job_id": job_id, "blob_url": blob_url}

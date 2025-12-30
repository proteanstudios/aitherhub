from fastapi import APIRouter, HTTPException

from app.schema.video_schema import GenerateUploadURLRequest, GenerateUploadURLResponse
from app.services.video_service import VideoService

router = APIRouter(
    prefix="/videos",
    tags=["videos"],
)

# Initialize service (could be injected via DI container)
video_service = VideoService()


@router.post("/generate-upload-url", response_model=GenerateUploadURLResponse)
async def generate_upload_url(payload: GenerateUploadURLRequest):
    try:
        result = await video_service.generate_upload_url(
            video_id=payload.video_id,
            filename=payload.filename,
        )
        return GenerateUploadURLResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {exc}")

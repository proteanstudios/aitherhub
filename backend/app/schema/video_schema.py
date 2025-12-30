from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schema.base_schema import ModelBaseInfo


class GenerateUploadURLRequest(BaseModel):
    """Request schema for generating upload URL"""
    filename: str
    video_id: Optional[str] = None

    class Config:
        schema_extra = {
            "example": {
                "filename": "my_video.mp4",
                "video_id": "550e8400-e29b-41d4-a716-446655440000"
            }
        }


class GenerateUploadURLResponse(BaseModel):
    """Response schema for upload URL generation"""
    video_id: str
    upload_url: str
    blob_url: str
    expires_at: datetime

    class Config:
        schema_extra = {
            "example": {
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "upload_url": "https://tien.blob.core.windows.net/videos/550e8400.mp4?se=...&sp=cw&sv=...",
                "blob_url": "https://tien.blob.core.windows.net/videos/550e8400.mp4",
                "expires_at": "2025-12-30T10:30:00+00:00"
            }
        }


class VideoResponse(ModelBaseInfo):
    """Video response schema"""
    filename: str
    blob_url: str
    status: str  # pending, processing, completed, failed
    duration: Optional[float] = None
    file_size: Optional[int] = None

    class Config:
        orm_mode = True

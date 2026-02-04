from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schema.base_schema import ModelBaseInfo


class GenerateUploadURLRequest(BaseModel):
    """Request schema for generating upload URL"""
    email: str
    filename: str
    video_id: Optional[str] = None

    class Config:
        schema_extra = {
            "example": {
                "email": "user@example.com",
                "filename": "my_video.mp4",
                "video_id": "550e8400-e29b-41d4-a716-446655440000"
            }
        }


class GenerateUploadURLResponse(BaseModel):
    """Response schema for upload URL generation"""
    video_id: str
    upload_id: str
    upload_url: str
    blob_url: str
    expires_at: datetime

    class Config:
        schema_extra = {
            "example": {
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "upload_id": "550e8400-e29b-41d4-a716-446655440001",
                "upload_url": "https://tien.blob.core.windows.net/videos/user@example.com/550e8400-e29b-41d4-a716-446655440000/550e8400.mp4?se=...&sp=cw&sv=...",
                "blob_url": "https://tien.blob.core.windows.net/videos/user@example.com/550e8400-e29b-41d4-a716-446655440000/550e8400.mp4",
                "expires_at": "2025-12-30T10:30:00+00:00"
            }
        }


class GenerateDownloadURLRequest(BaseModel):
    """Request schema for generating download URL"""
    email: str
    video_id: str
    filename: Optional[str] = None
    expires_in_minutes: Optional[int] = None

    class Config:
        schema_extra = {
            "example": {
                "email": "user@example.com",
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "filename": "my_video.mp4",
                "expires_in_minutes": 1440
            }
        }


class GenerateDownloadURLResponse(BaseModel):
    """Response schema for download URL generation"""
    video_id: str
    download_url: str
    expires_at: datetime

    class Config:
        schema_extra = {
            "example": {
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "download_url": "https://tien.blob.core.windows.net/videos/user@example.com/550e8400-e29b-41d4-a716-446655440000/550e8400.mp4?se=...&sp=r&sv=...",
                "expires_at": "2025-12-31T10:30:00+00:00"
            }
        }


class UploadCompleteRequest(BaseModel):
    """Request schema for upload completion"""
    email: str
    video_id: str
    filename: str
    upload_id: Optional[str] = None

    class Config:
        schema_extra = {
            "example": {
                "email": "user@example.com",
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "filename": "my_video.mp4",
                "upload_id": "550e8400-e29b-41d4-a716-446655440001"
            }
        }


class UploadCompleteResponse(BaseModel):
    """Response schema for upload completion"""
    video_id: str
    status: str
    message: str

    class Config:
        schema_extra = {
            "example": {
                "video_id": "550e8400-e29b-41d4-a716-446655440000",
                "status": "pending",
                "message": "Video upload completed successfully"
            }
        }


class VideoResponse(ModelBaseInfo):
    """Video response schema"""
    original_filename: Optional[str] = None
    status: str  # pending, processing, completed, failed
    duration: Optional[float] = None
    file_size: Optional[int] = None

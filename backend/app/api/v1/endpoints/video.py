from typing import List

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.schema.video_schema import (
    GenerateUploadURLRequest,
    GenerateUploadURLResponse,
    GenerateDownloadURLRequest,
    GenerateDownloadURLResponse,
    UploadCompleteRequest,
    UploadCompleteResponse,
    VideoResponse,
)
from app.services.video_service import VideoService
from app.repository.video_repository import VideoRepository
from app.core.dependencies import get_db, get_current_user

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
            email=payload.email,
            video_id=payload.video_id,
            filename=payload.filename,
        )
        return GenerateUploadURLResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {exc}")


@router.post("/generate-download-url", response_model=GenerateDownloadURLResponse)
async def generate_download_url(payload: GenerateDownloadURLRequest):
    try:
        result = await video_service.generate_download_url(
            email=payload.email,
            video_id=payload.video_id,
            filename=payload.filename,
            expires_in_minutes=payload.expires_in_minutes,
        )
        return GenerateDownloadURLResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {exc}")


@router.post("/upload-complete", response_model=UploadCompleteResponse)
async def upload_complete(
    payload: UploadCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Handle upload completion - save video info to database"""
    try:
        # Verify email matches current user (current_user is a dict)
        if current_user["email"] != payload.email:
            raise HTTPException(status_code=403, detail="Email does not match current user")
        
        # Initialize video service with repository
        video_repo = VideoRepository(lambda: db)
        service = VideoService(video_repository=video_repo)
        
        result = await service.handle_upload_complete(
            user_id=current_user["id"],
            email=payload.email,
            video_id=payload.video_id,
            original_filename=payload.filename,
        )
        return UploadCompleteResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete upload: {exc}")



@router.get("/user/{user_id}", response_model=List[VideoResponse])
async def get_videos_by_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
    Return list of videos for the given `user_id`.

    This endpoint requires authentication and only allows a user to fetch their own videos.
    """
    try:
        # Enforce that a user can only access their own videos
        if current_user and current_user.get("id") != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        video_repo = VideoRepository(lambda: db)
        videos = await video_repo.get_videos_by_user(user_id=user_id)

        return [VideoResponse.from_orm(v) for v in videos]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch videos: {exc}")



@router.get("/{video_id}")
async def get_video_detail(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
        Video detail endpoint returning report 1 data.

        Response shape:
        {
            "reports_1": [
                 { "phase_index": int, "phase_description": str | None, "insight": str }
            ]
        }
    """
    try:
        # verify video exists and ownership
        video_repo = VideoRepository(lambda: db)
        video = await video_repo.get_video_by_id(video_id)
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")

        if current_user and current_user.get("id") != video.user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # load phase_insights
        sql_insights = text("""
            SELECT phase_index, insight
            FROM phase_insights
            WHERE video_id = :video_id
            ORDER BY phase_index ASC
        """)

        res = await db.execute(sql_insights, {"video_id": video_id})
        insight_rows = res.fetchall()

        # load video_phases (to get phase_description, time_start, time_end)
        sql_phases = text("""
            SELECT phase_index, phase_description, time_start, time_end
            FROM video_phases
            WHERE video_id = :video_id
        """)
        pres = await db.execute(sql_phases, {"video_id": video_id})
        phase_rows = pres.fetchall()

        phase_map = {
            r.phase_index: {
                "phase_description": r.phase_description,
                "time_start": r.time_start,
                "time_end": r.time_end,
            }
            for r in phase_rows
        }

        items = []
        for r in insight_rows:
            pm = phase_map.get(r.phase_index, {})
            items.append({
                "phase_index": int(r.phase_index),
                "phase_description": pm.get("phase_description"),
                "time_start": pm.get("time_start"),
                "time_end": pm.get("time_end"),
                "insight": r.insight,
            })

        return {
            "id": str(video.id),
            "original_filename": video.original_filename,
            "status": video.status,
            "reports_1": items,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch video detail: {exc}")

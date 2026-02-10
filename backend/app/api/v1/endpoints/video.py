from typing import List
import json
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from loguru import logger

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
from app.utils.video_progress import calculate_progress, get_status_message
from app.core.container import Container
from app.models.orm.upload import Upload

router = APIRouter(
    prefix="/videos",
    tags=["videos"],
)

# Initialize service (could be injected via DI container)
video_service = VideoService()


@router.post("/generate-upload-url", response_model=GenerateUploadURLResponse)
async def generate_upload_url(
    payload: GenerateUploadURLRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await video_service.generate_upload_url(
            email=payload.email,
            db=db,
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
            db=db,
            upload_id=payload.upload_id,
        )
        return UploadCompleteResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete upload: {exc}")


@router.get("/uploads/check/{user_id}")
async def check_upload_resume(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Check if user has an in-progress upload to resume."""
    try:
        if current_user and current_user.get("id") != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        result = await db.execute(
            select(Upload)
            .where(Upload.user_id == user_id)
            .order_by(Upload.created_at.desc(), Upload.id.desc())
            .limit(1)
        )
        upload = result.scalar_one_or_none()

        if upload:
            return {"upload_resume": True, "upload_id": str(upload.id)}
        return {"upload_resume": False}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to check upload resume: {exc}")


@router.delete("/uploads/clear/{user_id}")
async def clear_user_uploads(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Clear all in-progress uploads for a user."""
    try:
        if current_user and current_user.get("id") != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # Delete all upload records for this user
        result = await db.execute(
            select(Upload).where(Upload.user_id == user_id)
        )
        uploads = result.scalars().all()
        deleted_count = len(uploads)

        for upload in uploads:
            await db.delete(upload)

        await db.commit()

        return {
            "status": "success",
            "message": f"Deleted {deleted_count} upload record(s) for user {user_id}",
            "deleted_count": deleted_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear uploads: {exc}")



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



@router.get("/{video_id}/status/stream")
async def stream_video_status(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
    Stream video processing status updates via Server-Sent Events (SSE).

    This endpoint provides real-time status updates for video processing.
    It polls the database every 2 seconds and sends status changes to the client.
    The stream automatically closes when processing reaches DONE or ERROR status.
    Supports long-running videos up to 4 hours with heartbeat messages every 30 seconds.

    Args:
        video_id: UUID of the video to monitor
        db: Database session
        current_user: Authenticated user

    Returns:
        StreamingResponse with SSE events containing:
        - status: Current processing status
        - progress: Progress percentage (0-100)
        - message: User-friendly Japanese status message
        - updated_at: Timestamp of last update
        - heartbeat: Boolean indicating heartbeat message (sent every 30 seconds)

    Example SSE events:
        data: {"video_id": "...", "status": "STEP_3_TRANSCRIBE_AUDIO", "progress": 40, "message": "音声書き起こし中...", "updated_at": "2026-01-20T..."}
        data: {"heartbeat": true, "timestamp": "2026-01-20T...", "poll_count": 15}
    """

    async def event_generator():
        last_status = None
        poll_count = 0
        max_polls = 7200  # 4 hours max for long videos (7200 * 2 seconds = 14400 seconds = 4 hours)

        try:
            # Verify video exists and ownership
            video_repo = VideoRepository(lambda: db)
            video = await video_repo.get_video_by_id(video_id)

            if not video:
                yield f"data: {json.dumps({'error': 'Video not found'})}\n\n"
                return

            if current_user and current_user.get("id") != video.user_id:
                yield f"data: {json.dumps({'error': 'Forbidden'})}\n\n"
                return

            # Stream status updates
            while poll_count < max_polls:
                try:
                    # Refresh video data
                    video = await video_repo.get_video_by_id(video_id)

                    if not video:
                        yield f"data: {json.dumps({'error': 'Video not found'})}\n\n"
                        break

                    current_status = video.status

                    # Send update only if status changed
                    if current_status != last_status:
                        progress = calculate_progress(current_status)
                        message = get_status_message(current_status)

                        payload = {
                            "video_id": str(video.id),
                            "status": current_status,
                            "progress": progress,
                            "message": message,
                            "updated_at": video.updated_at.isoformat() if video.updated_at else None,
                        }

                        yield f"data: {json.dumps(payload)}\n\n"
                        last_status = current_status

                        logger.info(f"SSE: Video {video_id} status changed to {current_status} ({progress}%)")

                    # Send heartbeat every 30 seconds (15 * 2 seconds) to keep connection alive
                    if poll_count > 0 and poll_count % 15 == 0:
                        heartbeat_payload = {
                            "heartbeat": True,
                            "timestamp": datetime.utcnow().isoformat(),
                            "poll_count": poll_count
                        }
                        yield f"data: {json.dumps(heartbeat_payload)}\n\n"
                        logger.debug(f"SSE: Heartbeat sent for video {video_id} (poll {poll_count})")

                    # Stop streaming if processing complete or error
                    if current_status in ["DONE", "ERROR"]:
                        yield "data: [DONE]\n\n"
                        logger.info(f"SSE: Video {video_id} processing completed with status {current_status}")
                        break

                    # Poll every 2 seconds
                    await asyncio.sleep(2)
                    poll_count += 1

                except Exception as e:
                    logger.error(f"SSE poll error for video {video_id}: {e}")
                    yield f"data: {json.dumps({'error': f'Poll error: {str(e)}'})}\n\n"
                    break

            # Timeout reached
            if poll_count >= max_polls:
                logger.warning(f"SSE: Video {video_id} stream timeout after {max_polls * 2} seconds")
                yield f"data: {json.dumps({'error': 'Stream timeout'})}\n\n"

        except Exception as e:
            logger.error(f"SSE stream error for video {video_id}: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Connection": "keep-alive",
        }
    )


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

        report1_items = []
        # Lấy email từ bảng users dựa vào user_id của video
        email = None
        if hasattr(video, "user_id") and video.user_id:
            sql_user = text("""
                SELECT email FROM users WHERE id = :user_id
            """)
            ures = await db.execute(sql_user, {"user_id": video.user_id})
            user_row = ures.fetchone()
            if user_row and hasattr(user_row, "email"):
                email = user_row.email
        # Nếu không có email, bỏ qua video_clip_url
        # Đồng bộ video_clip_url với SAS URL động
        from app.services.video_service import VideoService
        video_service = VideoService()
        for r in insight_rows:
            pm = phase_map.get(r.phase_index, {})
            time_start = pm.get("time_start")
            time_end = pm.get("time_end")
            video_clip_url = None
            if email and time_start is not None and time_end is not None:
                try:
                    ts = float(time_start)
                    te = float(time_end)
                    ts_str = f"{ts:.1f}"
                    te_str = f"{te:.1f}"
                    filename = f"{ts_str}_{te_str}.mp4"
                    # Gọi generate_download_url để lấy SAS URL
                    try:
                        download_url_result = await video_service.generate_download_url(
                            email=email,
                            video_id=video_id,
                            filename=f"reportvideo/{filename}",
                            expires_in_minutes=60*24,  # 1 ngày
                        )
                        video_clip_url = download_url_result.get("download_url")
                    except Exception as e:
                        video_clip_url = None
                except Exception:
                    video_clip_url = None
            report1_items.append({
                "phase_index": int(r.phase_index),
                "phase_description": pm.get("phase_description"),
                "time_start": time_start,
                "time_end": time_end,
                "insight": r.insight,
                "video_clip_url": video_clip_url,
            })

        # load latest video_insights record for report3 (single item)
        sql_latest_insight = text("""
            SELECT title, content, created_at
            FROM video_insights
            WHERE video_id = :video_id
            ORDER BY created_at DESC
            LIMIT 1
        """)

        rres = await db.execute(sql_latest_insight, {"video_id": video_id})
        latest = rres.fetchone()

        report3 = []
        if latest:
            # If content is a JSON string (starts with '{' or '['), parse it and
            # extract `video_insights`. Otherwise treat `content` as legacy
            # text and return it as a single report item.
            parsed = latest.content
            try:
                if isinstance(parsed, str):
                    s = parsed.lstrip()
                    if s.startswith("{") or s.startswith("["):
                        parsed = json.loads(parsed)

                if isinstance(parsed, dict) and parsed.get("video_insights") and isinstance(parsed.get("video_insights"), list):
                    for item in parsed.get("video_insights"):
                        report3.append({
                            "title": item.get("title"),
                            "content": item.get("content"),
                        })
                elif isinstance(parsed, list):
                    for item in parsed:
                        report3.append({
                            "title": item.get("title"),
                            "content": item.get("content"),
                        })
                else:
                    # legacy text report
                    report3.append({
                        "title": latest.title,
                        "content": latest.content,
                    })
            except Exception:
                report3.append({
                    "title": latest.title,
                    "content": latest.content,
                })

        return {
            "id": str(video.id),
            "original_filename": video.original_filename,
            "status": video.status,
            "reports_1": report1_items,
            "report3": report3,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch video detail: {exc}")

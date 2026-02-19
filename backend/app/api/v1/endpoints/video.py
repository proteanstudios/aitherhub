from typing import List
import json
import uuid as uuid_module
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
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
    GenerateExcelUploadURLRequest,
    GenerateExcelUploadURLResponse,
    RenameVideoRequest,
    RenameVideoResponse,
    DeleteVideoResponse,
    VideoResponse,
)
from app.services.video_service import VideoService
from app.repository.video_repository import VideoRepository
from app.core.dependencies import get_db, get_current_user
from app.utils.video_progress import calculate_progress, get_status_message
from app.core.container import Container
from app.models.orm.upload import Upload
from app.models.orm.video import Video

router = APIRouter(
    prefix="/videos",
    tags=["videos"],
)

# Initialize service (could be injected via DI container)
video_service = VideoService()


def _replace_blob_url_to_cdn(url: str) -> str:
    """Replace blob storage domain with CDN domain if applicable."""
    if url and isinstance(url, str):
        return url.replace(
            "https://aitherhub.blob.core.windows.net",
            "https://cdn.aitherhub.com"
        )
    return url


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
            upload_type=payload.upload_type or "screen_recording",
            excel_product_blob_url=payload.excel_product_blob_url,
            excel_trend_blob_url=payload.excel_trend_blob_url,
        )
        return UploadCompleteResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete upload: {exc}")


@router.post("/generate-excel-upload-url", response_model=GenerateExcelUploadURLResponse)
async def generate_excel_upload_url(
    payload: GenerateExcelUploadURLRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Generate SAS upload URLs for Excel files (product + trend_stats)"""
    try:
        service = VideoService()
        result = await service.generate_excel_upload_urls(
            email=payload.email,
            video_id=payload.video_id,
            product_filename=payload.product_filename,
            trend_filename=payload.trend_filename,
        )
        return GenerateExcelUploadURLResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel upload URLs: {exc}")


@router.get("/uploads/check/{user_id}")
async def check_upload_resume(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Check if user has an in-progress upload to resume.

    Returns upload_resume=True only when:
    - An Upload record exists for this user, AND
    - The record is less than 24 hours old, AND
    - No corresponding Video record exists that was created after the upload
      (which would indicate the upload already completed successfully)
    """
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

        if not upload:
            return {"upload_resume": False}

        # Check 1: If upload record is older than 24 hours, treat as stale
        now = datetime.now(timezone.utc)
        upload_created = (
            upload.created_at.replace(tzinfo=timezone.utc)
            if upload.created_at.tzinfo is None
            else upload.created_at
        )
        upload_age = now - upload_created
        if upload_age > timedelta(hours=24):
            logger.info(
                f"Stale upload record {upload.id} for user {user_id} "
                f"(age: {upload_age}). Deleting."
            )
            await db.delete(upload)
            await db.commit()
            return {"upload_resume": False}

        # Check 2: If any Video record exists for this user that was created
        # around the same time or after the Upload record, the upload has
        # already completed successfully — clean up and return false.
        video_result = await db.execute(
            select(Video)
            .where(
                Video.user_id == user_id,
                Video.status != "NEW",
            )
            .order_by(Video.created_at.desc())
            .limit(1)
        )
        latest_video = video_result.scalar_one_or_none()

        if latest_video and latest_video.created_at:
            video_created = (
                latest_video.created_at.replace(tzinfo=timezone.utc)
                if latest_video.created_at.tzinfo is None
                else latest_video.created_at
            )
            # If the latest video was created within 5 min before or after
            # the upload record, the upload is already complete
            if video_created >= upload_created - timedelta(minutes=5):
                logger.info(
                    f"Upload {upload.id} already completed "
                    f"(video {latest_video.id} status={latest_video.status}). "
                    f"Cleaning up stale upload record."
                )
                await db.delete(upload)
                await db.commit()
                return {"upload_resume": False}

        # Check 3: If any video for this user is currently being processed
        # (not in a terminal state), the upload was successful and processing
        # is underway — no need to show resume dialog.
        processing_result = await db.execute(
            select(Video)
            .where(
                Video.user_id == user_id,
                Video.status.notin_(["NEW", "DONE", "ERROR", "uploaded"]),
            )
            .limit(1)
        )
        processing_video = processing_result.scalar_one_or_none()
        if processing_video:
            logger.info(
                f"Upload {upload.id} has a video in processing "
                f"(video {processing_video.id} status={processing_video.status}). "
                f"Cleaning up upload record."
            )
            await db.delete(upload)
            await db.commit()
            return {"upload_resume": False}

        return {"upload_resume": True, "upload_id": str(upload.id)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to check upload resume for user {user_id}: {exc}")
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




@router.get("/user/{user_id}/with-clips")
async def get_videos_by_user_with_clips(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
    Return list of videos for the given `user_id` with clip counts.
    This is used by the sidebar to show clip availability indicators.
    """
    try:
        if current_user and current_user.get("id") != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        # Get videos with clip counts in a single query
        sql = text("""
            SELECT v.id, v.original_filename, v.status, v.duration, v.file_size,
                   v.upload_type, v.created_at, v.updated_at,
                   COALESCE(c.clip_count, 0) as clip_count,
                   COALESCE(c.completed_count, 0) as completed_clip_count
            FROM videos v
            LEFT JOIN (
                SELECT video_id,
                       COUNT(DISTINCT phase_index) as clip_count,
                       COUNT(DISTINCT CASE WHEN status = 'completed' THEN phase_index END) as completed_count
                FROM video_clips
                GROUP BY video_id
            ) c ON v.id = c.video_id
            WHERE v.user_id = :user_id
            ORDER BY v.created_at DESC
        """)
        result = await db.execute(sql, {"user_id": user_id})
        rows = result.fetchall()

        videos = []
        for row in rows:
            videos.append({
                "id": str(row.id),
                "original_filename": row.original_filename,
                "status": row.status,
                "duration": row.duration,
                "file_size": row.file_size,
                "upload_type": row.upload_type,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "clip_count": row.clip_count,
                "completed_clip_count": row.completed_clip_count,
            })

        return videos

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Failed to fetch videos with clips: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch videos: {exc}")


@router.delete("/{video_id}", response_model=DeleteVideoResponse)
async def delete_video(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Delete a video and its related data (only owner can delete)."""
    try:
        user_id = current_user["id"]
        video_repo = VideoRepository(lambda: db)

        # Delete related records first (video_phases, video_insights, etc.)
        await db.execute(text("DELETE FROM video_phases WHERE video_id = :vid"), {"vid": video_id})
        await db.execute(text("DELETE FROM video_insights WHERE video_id = :vid"), {"vid": video_id})
        await db.commit()

        # Delete the video record
        deleted = await video_repo.delete_video(video_id=video_id, user_id=user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Video not found or not owned by user")

        return DeleteVideoResponse(id=video_id, message="Video deleted successfully")
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete video: {exc}")


@router.patch("/{video_id}/rename", response_model=RenameVideoResponse)
async def rename_video(
    video_id: str,
    payload: RenameVideoRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Rename a video (only owner can rename)."""
    try:
        user_id = current_user["id"]
        video_repo = VideoRepository(lambda: db)
        video = await video_repo.rename_video(
            video_id=video_id, user_id=user_id, new_name=payload.name
        )
        if not video:
            raise HTTPException(status_code=404, detail="Video not found or not owned by user")

        return RenameVideoResponse(
            id=str(video.id),
            original_filename=video.original_filename,
            message="Video renamed successfully",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to rename video: {exc}")


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
        # Try with product_names column first, fall back without it
        sql_phases_with_pn = text("""
            SELECT phase_index, phase_description, time_start, time_end,
                   COALESCE(gmv, 0) as gmv,
                   COALESCE(order_count, 0) as order_count,
                   COALESCE(viewer_count, 0) as viewer_count,
                   COALESCE(like_count, 0) as like_count,
                   COALESCE(comment_count, 0) as comment_count,
                   COALESCE(share_count, 0) as share_count,
                   COALESCE(new_followers, 0) as new_followers,
                   COALESCE(product_clicks, 0) as product_clicks,
                   COALESCE(conversion_rate, 0) as conversion_rate,
                   COALESCE(gpm, 0) as gpm,
                   COALESCE(importance_score, 0) as importance_score,
                   product_names,
                   user_rating,
                   user_comment
            FROM video_phases
            WHERE video_id = :video_id
        """)
        sql_phases_without_pn = text("""
            SELECT phase_index, phase_description, time_start, time_end,
                   COALESCE(gmv, 0) as gmv,
                   COALESCE(order_count, 0) as order_count,
                   COALESCE(viewer_count, 0) as viewer_count,
                   COALESCE(like_count, 0) as like_count,
                   COALESCE(comment_count, 0) as comment_count,
                   COALESCE(share_count, 0) as share_count,
                   COALESCE(new_followers, 0) as new_followers,
                   COALESCE(product_clicks, 0) as product_clicks,
                   COALESCE(conversion_rate, 0) as conversion_rate,
                   COALESCE(gpm, 0) as gpm,
                   COALESCE(importance_score, 0) as importance_score
            FROM video_phases
            WHERE video_id = :video_id
        """)

        has_product_names = False
        try:
            pres = await db.execute(sql_phases_with_pn, {"video_id": video_id})
            phase_rows = pres.fetchall()
            has_product_names = True
        except Exception:
            await db.rollback()
            pres = await db.execute(sql_phases_without_pn, {"video_id": video_id})
            phase_rows = pres.fetchall()

        phase_map = {}
        for r in phase_rows:
            entry = {
                "phase_description": r.phase_description,
                "time_start": r.time_start,
                "time_end": r.time_end,
                "gmv": r.gmv,
                "order_count": r.order_count,
                "viewer_count": r.viewer_count,
                "like_count": r.like_count,
                "comment_count": r.comment_count,
                "share_count": r.share_count,
                "new_followers": r.new_followers,
                "product_clicks": r.product_clicks,
                "conversion_rate": r.conversion_rate,
                "gpm": r.gpm,
                "importance_score": r.importance_score,
                "product_names": getattr(r, 'product_names', None) if has_product_names else None,
                "user_rating": getattr(r, 'user_rating', None),
                "user_comment": getattr(r, 'user_comment', None),
            }
            phase_map[r.phase_index] = entry

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

                    # First, try to find the video_phases record matching this phase
                    sql_phase_check = text("""
                        SELECT id, sas_token, sas_expireddate
                        FROM video_phases
                        WHERE video_id = :video_id AND time_start = :ts AND time_end = :te
                        LIMIT 1
                    """)
                    pres = await db.execute(sql_phase_check, {"video_id": video_id, "ts": ts, "te": te})
                    phase_row = pres.fetchone()

                    need_generate = True
                    if phase_row:
                        sas_token = getattr(phase_row, "sas_token", None)
                        sas_expire = getattr(phase_row, "sas_expireddate", None)
                        if sas_token and sas_expire:
                            # Handle naive vs aware datetimes safely
                            if sas_expire.tzinfo is not None and sas_expire.tzinfo.utcoffset(sas_expire) is not None:
                                now = datetime.now(timezone.utc)
                                sas_expire_cmp = sas_expire.astimezone(timezone.utc)
                            else:
                                now = datetime.utcnow()
                                sas_expire_cmp = sas_expire

                            if sas_expire_cmp >= now:
                                # Existing valid SAS — reuse
                                video_clip_url = sas_token
                                need_generate = False

                    if need_generate:
                        try:
                            download_url_result = await video_service.generate_download_url(
                                email=email,
                                video_id=video_id,
                                filename=f"reportvideo/{filename}",
                                expires_in_minutes=60 * 24,  # 1 day
                            )
                            video_clip_url = _replace_blob_url_to_cdn(download_url_result.get("download_url"))

                            # Persist new SAS info back to video_phases if we have a matching row
                            if video_clip_url and phase_row:
                                expires_at = download_url_result.get("expires_at")
                                if isinstance(expires_at, str):
                                    try:
                                        expires_at = datetime.fromisoformat(expires_at)
                                    except Exception:
                                        expires_at = None

                                if expires_at is None:
                                    expires_at = datetime.utcnow() + timedelta(days=1)

                                sql_update = text("""
                                    UPDATE video_phases
                                    SET sas_token = :sas_token, sas_expireddate = :sas_expireddate
                                    WHERE id = :id
                                """)
                                await db.execute(sql_update, {"sas_token": video_clip_url, "sas_expireddate": expires_at, "id": phase_row.id})
                                await db.commit()

                        except Exception:
                            video_clip_url = None
                except Exception:
                    video_clip_url = None

            # Parse product_names JSON string into list
            product_names_raw = pm.get("product_names")
            product_names_list = []
            if product_names_raw:
                try:
                    product_names_list = json.loads(product_names_raw) if isinstance(product_names_raw, str) else product_names_raw
                except (json.JSONDecodeError, TypeError):
                    product_names_list = []

            report1_items.append({
                "phase_index": int(r.phase_index),
                "phase_description": pm.get("phase_description"),
                "time_start": time_start,
                "time_end": time_end,
                "insight": r.insight,
                "video_clip_url": video_clip_url,
                "user_rating": pm.get("user_rating"),
                "user_comment": pm.get("user_comment"),
                "csv_metrics": {
                    "gmv": pm.get("gmv", 0),
                    "order_count": pm.get("order_count", 0),
                    "viewer_count": pm.get("viewer_count", 0),
                    "like_count": pm.get("like_count", 0),
                    "comment_count": pm.get("comment_count", 0),
                    "share_count": pm.get("share_count", 0),
                    "new_followers": pm.get("new_followers", 0),
                    "product_clicks": pm.get("product_clicks", 0),
                    "conversion_rate": pm.get("conversion_rate", 0),
                    "gpm": pm.get("gpm", 0),
                    "importance_score": pm.get("importance_score", 0),
                    "product_names": product_names_list,
                },
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
            "upload_type": getattr(video, 'upload_type', None),
            "excel_product_blob_url": getattr(video, 'excel_product_blob_url', None),
            "excel_trend_blob_url": getattr(video, 'excel_trend_blob_url', None),
            "reports_1": report1_items,
            "report3": report3,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch video detail: {exc}")


@router.get("/{video_id}/product-data")
async def get_video_product_data(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Fetch and parse the product Excel file for a video.
    Returns parsed product data as JSON.
    Uses SAS tokens to access Azure Blob Storage (public access is disabled).
    """
    try:
        import httpx
        import tempfile
        import os
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions
        from datetime import timedelta

        # Get video's excel_product_blob_url and user email
        result = await db.execute(
            text("""
                SELECT v.excel_product_blob_url, v.excel_trend_blob_url, u.email
                FROM videos v
                JOIN users u ON v.user_id = u.id
                WHERE v.id = :vid
            """),
            {"vid": video_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")

        product_blob_url = row[0]
        trend_blob_url = row[1]
        email = row[2]

        response_data = {
            "products": [],
            "trends": [],
            "has_product_data": False,
            "has_trend_data": False,
        }

        # Helper: generate SAS download URL from blob URL
        def _generate_sas_url(blob_url: str) -> str:
            """Generate a SAS-signed download URL from a raw blob URL."""
            conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
            account_name = ""
            account_key = ""
            for part in conn_str.split(";"):
                if part.startswith("AccountName="):
                    account_name = part.split("=", 1)[1]
                elif part.startswith("AccountKey="):
                    account_key = part.split("=", 1)[1]

            # Extract blob path from URL
            # URL format: https://account.blob.core.windows.net/videos/email/video_id/excel/filename.xlsx
            try:
                from urllib.parse import urlparse, unquote
                parsed = urlparse(blob_url)
                path = unquote(parsed.path)  # /videos/email/video_id/excel/filename.xlsx
                # Remove leading /videos/ to get blob_name
                if path.startswith("/videos/"):
                    blob_name = path[len("/videos/"):]
                else:
                    blob_name = path.lstrip("/")
                    # Remove container name if present
                    if blob_name.startswith("videos/"):
                        blob_name = blob_name[len("videos/"):]
            except Exception:
                # Fallback: construct blob name from email/video_id
                filename = blob_url.split("/")[-1].split("?")[0]
                blob_name = f"{email}/{video_id}/excel/{filename}"

            expiry = datetime.now(timezone.utc) + timedelta(minutes=30)
            sas = generate_blob_sas(
                account_name=account_name,
                container_name="videos",
                blob_name=blob_name,
                account_key=account_key,
                permission=BlobSasPermissions(read=True),
                expiry=expiry,
            )
            return f"https://{account_name}.blob.core.windows.net/videos/{blob_name}?{sas}"

        # Helper: download and parse Excel file
        async def _parse_excel(blob_url: str) -> list:
            """Download Excel via SAS URL and parse rows into list of dicts."""
            sas_url = _generate_sas_url(blob_url)
            import openpyxl
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(sas_url)
                if resp.status_code != 200:
                    logger.warning(f"Failed to download Excel (HTTP {resp.status_code}): {sas_url[:100]}...")
                    return []

                with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
                    f.write(resp.content)
                    tmp_path = f.name

                try:
                    wb = openpyxl.load_workbook(tmp_path, read_only=True, data_only=True)
                    ws = wb.active
                    items = []
                    if ws:
                        rows_data = list(ws.iter_rows(values_only=True))
                        if len(rows_data) >= 2:
                            headers = [str(h).strip() if h else f"col_{i}" for i, h in enumerate(rows_data[0])]
                            for data_row in rows_data[1:]:
                                if all(v is None for v in data_row):
                                    continue
                                item = {}
                                for i, val in enumerate(data_row):
                                    if i < len(headers):
                                        if val is None:
                                            item[headers[i]] = None
                                        elif isinstance(val, (int, float)):
                                            item[headers[i]] = val
                                        else:
                                            item[headers[i]] = str(val)
                                items.append(item)
                    wb.close()
                    return items
                finally:
                    os.unlink(tmp_path)

        # Parse product Excel
        if product_blob_url:
            try:
                products = await _parse_excel(product_blob_url)
                response_data["products"] = products
                response_data["has_product_data"] = len(products) > 0
            except Exception as e:
                logger.warning(f"Failed to parse product Excel: {e}")

        # Parse trend Excel
        if trend_blob_url:
            try:
                trends = await _parse_excel(trend_blob_url)
                response_data["trends"] = trends
                response_data["has_trend_data"] = len(trends) > 0
            except Exception as e:
                logger.warning(f"Failed to parse trend Excel: {e}")

        return response_data

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to fetch product data: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch product data: {exc}")



# =========================
# Clip generation endpoints
# =========================

@router.post("/{video_id}/clips")
async def request_clip_generation(
    video_id: str,
    request_body: dict,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Request TikTok-style clip generation for a specific phase.
    
    Body:
    {
        "phase_index": 0,
        "time_start": 0.0,
        "time_end": 51.0
    }
    """
    try:
        user_id = user.get("user_id") or user.get("id")
        phase_index = request_body.get("phase_index")
        time_start = request_body.get("time_start")
        time_end = request_body.get("time_end")

        if phase_index is None or time_start is None or time_end is None:
            raise HTTPException(status_code=400, detail="phase_index, time_start, time_end are required")

        time_start = float(time_start)
        time_end = float(time_end)

        if time_end <= time_start:
            raise HTTPException(status_code=400, detail="time_end must be greater than time_start")

        # Check if clip already exists for this phase
        existing_sql = text("""
            SELECT id, status, clip_url
            FROM video_clips
            WHERE video_id = :video_id AND phase_index = :phase_index
            ORDER BY created_at DESC
            LIMIT 1
        """)
        existing = await db.execute(existing_sql, {"video_id": video_id, "phase_index": phase_index})
        existing_row = existing.fetchone()

        if existing_row:
            if existing_row.status == "completed" and existing_row.clip_url:
                # Already generated - return existing
                return {
                    "clip_id": str(existing_row.id),
                    "status": "completed",
                    "clip_url": _replace_blob_url_to_cdn(existing_row.clip_url),
                    "message": "Clip already generated",
                }
            elif existing_row.status in ("pending", "processing"):
                # Already in progress
                return {
                    "clip_id": str(existing_row.id),
                    "status": existing_row.status,
                    "message": "Clip generation already in progress",
                }
            # If failed, create a new one

        # Verify video belongs to user
        video_sql = text("SELECT id, user_id, original_filename FROM videos WHERE id = :video_id")
        vres = await db.execute(video_sql, {"video_id": video_id})
        video_row = vres.fetchone()

        if not video_row:
            raise HTTPException(status_code=404, detail="Video not found")
        if video_row.user_id != user_id:
            raise HTTPException(status_code=403, detail="Not authorized")

        # Get user email for blob path
        user_sql = text("SELECT email FROM users WHERE id = :user_id")
        ures = await db.execute(user_sql, {"user_id": user_id})
        user_row = ures.fetchone()
        email = user_row.email if user_row else None

        if not email:
            raise HTTPException(status_code=400, detail="User email not found")

        # Generate download SAS URL for source video
        from app.services.storage_service import generate_download_sas
        download_url, _ = await generate_download_sas(
            email=email,
            video_id=video_id,
            filename=video_row.original_filename,
            expires_in_minutes=1440,
        )

        # Create clip record
        clip_id = str(uuid_module.uuid4())
        insert_sql = text("""
            INSERT INTO video_clips (id, video_id, user_id, phase_index, time_start, time_end, status)
            VALUES (:id, :video_id, :user_id, :phase_index, :time_start, :time_end, 'pending')
        """)
        await db.execute(insert_sql, {
            "id": clip_id,
            "video_id": video_id,
            "user_id": user_id,
            "phase_index": phase_index,
            "time_start": time_start,
            "time_end": time_end,
        })
        await db.commit()

        # Enqueue clip generation job
        from app.services.queue_service import enqueue_job
        await enqueue_job({
            "job_type": "generate_clip",
            "clip_id": clip_id,
            "video_id": video_id,
            "blob_url": download_url,
            "time_start": time_start,
            "time_end": time_end,
        })

        logger.info(f"Clip generation requested: clip_id={clip_id}, video_id={video_id}, phase={phase_index}")

        return {
            "clip_id": clip_id,
            "status": "pending",
            "message": "Clip generation started",
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Failed to request clip generation: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to request clip generation: {exc}")


@router.get("/{video_id}/clips/{phase_index}")
async def get_clip_status(
    video_id: str,
    phase_index: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Get clip generation status and download URL for a specific phase."""
    try:
        user_id = user.get("user_id") or user.get("id")

        sql = text("""
            SELECT id, status, clip_url, sas_token, sas_expireddate, error_message, created_at
            FROM video_clips
            WHERE video_id = :video_id AND phase_index = :phase_index
            ORDER BY created_at DESC
            LIMIT 1
        """)
        result = await db.execute(sql, {"video_id": video_id, "phase_index": phase_index})
        row = result.fetchone()

        if not row:
            return {
                "status": "not_found",
                "message": "No clip found for this phase",
            }

        response = {
            "clip_id": str(row.id),
            "status": row.status,
        }

        if row.status == "completed" and row.clip_url:
            # Generate or reuse SAS download URL
            clip_download_url = None

            # Check if existing SAS is still valid
            if row.sas_token and row.sas_expireddate:
                now = datetime.now(timezone.utc)
                expiry = row.sas_expireddate
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
                if expiry > now:
                    clip_download_url = row.sas_token

            if not clip_download_url:
                # Generate new SAS URL for clip
                try:
                    # Get user email
                    user_sql = text("SELECT email FROM users WHERE id = :user_id")
                    ures = await db.execute(user_sql, {"user_id": user_id})
                    user_row = ures.fetchone()

                    if user_row:
                        # Extract blob path from clip_url
                        from app.services.storage_service import generate_download_sas
                        # Parse the clip blob name from the URL
                        clip_url = row.clip_url
                        # clip_url format: https://account.blob.core.windows.net/container/email/video_id/clips/clip_X_Y.mp4
                        parts = clip_url.split("/")
                        # Find the email/video_id/clips/filename part
                        try:
                            container_idx = parts.index("videos") if "videos" in parts else -1
                            if container_idx >= 0 and container_idx + 1 < len(parts):
                                blob_path = "/".join(parts[container_idx + 1:])
                                from azure.storage.blob import generate_blob_sas, BlobSasPermissions
                                import os as _os
                                conn_str = _os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
                                account_name = ""
                                account_key = ""
                                for p in conn_str.split(";"):
                                    if p.startswith("AccountName="):
                                        account_name = p.split("=", 1)[1]
                                    if p.startswith("AccountKey="):
                                        account_key = p.split("=", 1)[1]

                                if account_name and account_key:
                                    expiry_dt = datetime.now(timezone.utc) + timedelta(hours=24)
                                    sas = generate_blob_sas(
                                        account_name=account_name,
                                        container_name="videos",
                                        blob_name=blob_path,
                                        account_key=account_key,
                                        permission=BlobSasPermissions(read=True),
                                        expiry=expiry_dt,
                                    )
                                    clip_download_url = f"https://{account_name}.blob.core.windows.net/videos/{blob_path}?{sas}"
                                    clip_download_url = _replace_blob_url_to_cdn(clip_download_url)

                                    # Cache the SAS token
                                    update_sql = text("""
                                        UPDATE video_clips
                                        SET sas_token = :sas_token, sas_expireddate = :expiry
                                        WHERE id = :id
                                    """)
                                    await db.execute(update_sql, {
                                        "sas_token": clip_download_url,
                                        "expiry": expiry_dt,
                                        "id": row.id,
                                    })
                                    await db.commit()
                        except Exception as e:
                            logger.warning(f"Failed to parse clip blob path: {e}")
                except Exception as e:
                    logger.warning(f"Failed to generate clip SAS: {e}")

            response["clip_url"] = clip_download_url or _replace_blob_url_to_cdn(row.clip_url)

        elif row.status == "failed":
            response["error_message"] = row.error_message

        return response

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Failed to get clip status: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to get clip status: {exc}")


@router.get("/{video_id}/clips")
async def list_clips(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all clips for a video."""
    try:
        user_id = user.get("user_id") or user.get("id")

        sql = text("""
            SELECT id, phase_index, time_start, time_end, status, clip_url, sas_token, sas_expireddate, created_at
            FROM video_clips
            WHERE video_id = :video_id
            ORDER BY phase_index ASC, created_at DESC
        """)
        result = await db.execute(sql, {"video_id": video_id})
        rows = result.fetchall()

        clips = []
        seen_phases = set()
        for row in rows:
            # Only include the latest clip per phase
            if row.phase_index in seen_phases:
                continue
            seen_phases.add(row.phase_index)

            clip = {
                "clip_id": str(row.id),
                "phase_index": row.phase_index,
                "time_start": row.time_start,
                "time_end": row.time_end,
                "status": row.status,
            }
            if row.status == "completed" and row.clip_url:
                # Generate or reuse SAS download URL (same logic as get_clip_status)
                clip_download_url = None

                # Check if existing SAS is still valid
                if row.sas_token and row.sas_expireddate:
                    now = datetime.now(timezone.utc)
                    expiry = row.sas_expireddate
                    if expiry.tzinfo is None:
                        expiry = expiry.replace(tzinfo=timezone.utc)
                    if expiry > now:
                        clip_download_url = row.sas_token

                if not clip_download_url:
                    # Generate new SAS URL for clip
                    try:
                        clip_url = row.clip_url
                        parts = clip_url.split("/")
                        container_idx = parts.index("videos") if "videos" in parts else -1
                        if container_idx >= 0 and container_idx + 1 < len(parts):
                            blob_path = "/".join(parts[container_idx + 1:])
                            from azure.storage.blob import generate_blob_sas, BlobSasPermissions
                            import os as _os
                            conn_str = _os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
                            account_name = ""
                            account_key = ""
                            for p in conn_str.split(";"):
                                if p.startswith("AccountName="):
                                    account_name = p.split("=", 1)[1]
                                if p.startswith("AccountKey="):
                                    account_key = p.split("=", 1)[1]

                            if account_name and account_key:
                                expiry_dt = datetime.now(timezone.utc) + timedelta(hours=24)
                                sas = generate_blob_sas(
                                    account_name=account_name,
                                    container_name="videos",
                                    blob_name=blob_path,
                                    account_key=account_key,
                                    permission=BlobSasPermissions(read=True),
                                    expiry=expiry_dt,
                                )
                                clip_download_url = f"https://{account_name}.blob.core.windows.net/videos/{blob_path}?{sas}"
                                clip_download_url = _replace_blob_url_to_cdn(clip_download_url)

                                # Cache the SAS token
                                update_sql = text("""
                                    UPDATE video_clips
                                    SET sas_token = :sas_token, sas_expireddate = :expiry
                                    WHERE id = :id
                                """)
                                await db.execute(update_sql, {
                                    "sas_token": clip_download_url,
                                    "expiry": expiry_dt,
                                    "id": row.id,
                                })
                                await db.commit()
                    except Exception as e:
                        logger.warning(f"Failed to generate clip SAS in list: {e}")

                clip["clip_url"] = clip_download_url or _replace_blob_url_to_cdn(row.clip_url)
            clips.append(clip)

        return {"clips": clips}

    except Exception as exc:
        logger.exception(f"Failed to list clips: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to list clips: {exc}")



# ──────────────────────────────────────────────────────────────
# Phase Rating (Human Feedback)
# ──────────────────────────────────────────────────────────────

@router.put("/{video_id}/phases/{phase_index}/rating")
async def rate_phase(
    video_id: str,
    phase_index: int,
    request_body: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Save a human rating (1-5) and optional comment for a specific phase.
    Also updates the quality_score in Qdrant for RAG learning.

    Body:
    {
        "rating": 1-5,
        "comment": "optional text"
    }
    """
    try:
        user_id = user.get("user_id") or user.get("id")
        rating = request_body.get("rating")
        comment = request_body.get("comment", "")

        if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
            raise HTTPException(status_code=400, detail="rating must be an integer between 1 and 5")

        # Verify video belongs to user
        video_repo = VideoRepository(lambda: db)
        video = await video_repo.get_video_by_id(video_id)
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        if str(getattr(video, "user_id", None)) != str(user_id):
            raise HTTPException(status_code=403, detail="Forbidden")

        # Map rating (1-5) to importance_score (0.0-1.0)
        importance_score = (rating - 1) / 4.0  # 1->0.0, 2->0.25, 3->0.5, 4->0.75, 5->1.0

        # Update video_phases with user rating, comment, and importance_score
        # Use try-except for graceful fallback if columns don't exist yet
        try:
            sql_update = text("""
                UPDATE video_phases
                SET user_rating = :rating,
                    user_comment = :comment,
                    importance_score = :importance_score,
                    rated_at = NOW(),
                    updated_at = NOW()
                WHERE video_id = :video_id AND phase_index = :phase_index
            """)
            await db.execute(sql_update, {
                "rating": rating,
                "comment": comment,
                "importance_score": importance_score,
                "video_id": video_id,
                "phase_index": phase_index,
            })
            await db.commit()
        except Exception as db_err:
            await db.rollback()
            # Fallback: try without user_rating/user_comment columns
            try:
                sql_fallback = text("""
                    UPDATE video_phases
                    SET importance_score = :importance_score,
                        updated_at = NOW()
                    WHERE video_id = :video_id AND phase_index = :phase_index
                """)
                await db.execute(sql_fallback, {
                    "importance_score": importance_score,
                    "video_id": video_id,
                    "phase_index": phase_index,
                })
                await db.commit()
            except Exception:
                await db.rollback()
                logger.warning(f"Could not update video_phases for rating: {db_err}")

        # Update Qdrant quality_score for RAG learning (in background for faster response)
        def _update_qdrant_bg(vid, pidx, r, c):
            try:
                from app.services.rag.knowledge_store import update_quality_score_with_comment
                update_quality_score_with_comment(
                    video_id=vid, phase_index=pidx, rating=r, comment=c,
                )
            except ImportError:
                try:
                    from app.services.rag.knowledge_store import update_quality_score
                    old_rating = 1 if r >= 4 else (-1 if r <= 2 else 0)
                    update_quality_score(video_id=vid, phase_index=pidx, rating=old_rating)
                except Exception as rag_err:
                    logger.warning(f"Could not update Qdrant quality_score: {rag_err}")
            except Exception as rag_err:
                logger.warning(f"Could not update Qdrant quality_score: {rag_err}")

        background_tasks.add_task(_update_qdrant_bg, video_id, phase_index, rating, comment)

        logger.info(f"Phase rated: video={video_id}, phase={phase_index}, rating={rating}, comment={comment[:50] if comment else ''}")

        return {
            "success": True,
            "video_id": video_id,
            "phase_index": phase_index,
            "rating": rating,
            "comment": comment,
            "importance_score": importance_score,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Failed to rate phase: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to rate phase: {exc}")

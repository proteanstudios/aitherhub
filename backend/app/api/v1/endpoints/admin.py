"""
Admin dashboard API endpoint.
Provides platform-wide statistics for the master dashboard.
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from loguru import logger
from typing import Optional

from app.core.dependencies import get_db, get_current_user

router = APIRouter(prefix="/admin", tags=["Admin"])

# Simple admin credentials
ADMIN_ID = "aither"
ADMIN_PASS = "hub"


async def _get_dashboard_data(db: AsyncSession) -> dict:
    """Shared logic to gather all dashboard statistics."""
    # ── Data Volume (データ量) ──
    total_videos_result = await db.execute(text("SELECT COUNT(*) FROM videos"))
    total_videos = total_videos_result.scalar() or 0

    done_result = await db.execute(
        text("SELECT COUNT(*) FROM videos WHERE status = 'DONE'")
    )
    analyzed_videos = done_result.scalar() or 0

    pending_videos = total_videos - analyzed_videos

    # Total video duration (seconds) from video_phases
    try:
        duration_result = await db.execute(
            text("""
                SELECT COALESCE(SUM(
                    CAST(SPLIT_PART(time_end, ':', 1) AS INTEGER) * 3600 +
                    CAST(SPLIT_PART(time_end, ':', 2) AS INTEGER) * 60 +
                    CAST(SPLIT_PART(time_end, ':', 3) AS FLOAT)
                ), 0)
                FROM (
                    SELECT DISTINCT ON (video_id) video_id, time_end
                    FROM video_phases
                    ORDER BY video_id, phase_index DESC
                ) last_phases
            """)
        )
        total_duration_seconds = int(duration_result.scalar() or 0)
    except Exception as e:
        logger.warning(f"Failed to calculate total duration: {e}")
        total_duration_seconds = 0

    # ── Video Types (動画タイプ) ──
    screen_recording_result = await db.execute(
        text("SELECT COUNT(*) FROM videos WHERE upload_type = 'screen_recording' OR upload_type IS NULL")
    )
    screen_recording_count = screen_recording_result.scalar() or 0

    clean_video_result = await db.execute(
        text("SELECT COUNT(*) FROM videos WHERE upload_type = 'clean_video'")
    )
    clean_video_count = clean_video_result.scalar() or 0

    latest_upload_result = await db.execute(
        text("SELECT MAX(created_at) FROM videos")
    )
    latest_upload_raw = latest_upload_result.scalar()
    latest_upload = str(latest_upload_raw) if latest_upload_raw else None

    # ── User Scale (会員規模) ──
    total_users_result = await db.execute(
        text("SELECT COUNT(*) FROM users WHERE is_active = true")
    )
    total_users = total_users_result.scalar() or 0

    # Users who have uploaded at least one video (配信者)
    streamers_result = await db.execute(
        text("SELECT COUNT(DISTINCT user_id) FROM videos")
    )
    total_streamers = streamers_result.scalar() or 0

    # Users who uploaded this month
    this_month_uploaders_result = await db.execute(
        text("""
            SELECT COUNT(DISTINCT user_id) FROM videos
            WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
        """)
    )
    this_month_uploaders = this_month_uploaders_result.scalar() or 0

    # Format duration as hours and minutes
    total_hours = total_duration_seconds // 3600
    total_minutes = (total_duration_seconds % 3600) // 60

    return {
        "data_volume": {
            "total_videos": total_videos,
            "analyzed_videos": analyzed_videos,
            "pending_videos": pending_videos,
            "total_duration_seconds": total_duration_seconds,
            "total_duration_display": f"{total_hours}時間{total_minutes}分",
        },
        "video_types": {
            "screen_recording_count": screen_recording_count,
            "clean_video_count": clean_video_count,
            "latest_upload": latest_upload,
        },
        "user_scale": {
            "total_users": total_users,
            "total_streamers": total_streamers,
            "this_month_uploaders": this_month_uploaders,
        },
    }


@router.get("/dashboard")
async def get_dashboard_stats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get platform-wide statistics (JWT auth, admin role required).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        return await _get_dashboard_data(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dashboard stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard statistics")


@router.get("/dashboard-public")
async def get_dashboard_stats_public(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get platform-wide statistics (simple ID:password auth via header).
    """
    expected_key = f"{ADMIN_ID}:{ADMIN_PASS}"
    if x_admin_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin credentials")

    try:
        return await _get_dashboard_data(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dashboard stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard statistics")

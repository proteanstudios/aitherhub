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


async def _safe_scalar(db: AsyncSession, sql: str, default=0):
    """Execute a query and return scalar, with error fallback."""
    try:
        result = await db.execute(text(sql))
        val = result.scalar()
        return val if val is not None else default
    except Exception as e:
        logger.warning(f"Query failed: {sql[:80]}... Error: {e}")
        return default


async def _get_dashboard_data(db: AsyncSession) -> dict:
    """Shared logic to gather all dashboard statistics."""

    # ── Data Volume (データ量) ──
    total_videos = await _safe_scalar(db, "SELECT COUNT(*) FROM videos")
    analyzed_videos = await _safe_scalar(
        db, "SELECT COUNT(*) FROM videos WHERE status = 'DONE'"
    )
    pending_videos = total_videos - analyzed_videos

    # Total video duration - use simpler query with MAX per video
    total_duration_seconds = 0
    try:
        duration_result = await db.execute(text("""
            SELECT COALESCE(SUM(max_seconds), 0) FROM (
                SELECT video_id, MAX(
                    CAST(SPLIT_PART(time_end, ':', 1) AS INTEGER) * 3600 +
                    CAST(SPLIT_PART(time_end, ':', 2) AS INTEGER) * 60 +
                    CAST(SPLIT_PART(SPLIT_PART(time_end, ':', 3), '.', 1) AS INTEGER)
                ) as max_seconds
                FROM video_phases
                WHERE time_end IS NOT NULL AND time_end != ''
                GROUP BY video_id
            ) sub
        """))
        total_duration_seconds = int(duration_result.scalar() or 0)
    except Exception as e:
        logger.warning(f"Failed to calculate total duration: {e}")

    # ── Video Types (動画タイプ) ──
    screen_recording_count = await _safe_scalar(
        db,
        "SELECT COUNT(*) FROM videos WHERE upload_type = 'screen_recording' OR upload_type IS NULL",
    )
    clean_video_count = await _safe_scalar(
        db, "SELECT COUNT(*) FROM videos WHERE upload_type = 'clean_video'"
    )

    latest_upload = None
    try:
        result = await db.execute(text("SELECT MAX(created_at) FROM videos"))
        raw = result.scalar()
        latest_upload = str(raw) if raw else None
    except Exception as e:
        logger.warning(f"Failed to get latest upload: {e}")

    # ── User Scale (会員規模) ──
    total_users = await _safe_scalar(
        db, "SELECT COUNT(*) FROM users WHERE is_active = true"
    )
    total_streamers = await _safe_scalar(
        db, "SELECT COUNT(DISTINCT user_id) FROM videos"
    )

    this_month_uploaders = 0
    try:
        result = await db.execute(text(
            "SELECT COUNT(DISTINCT user_id) FROM videos "
            "WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)"
        ))
        this_month_uploaders = result.scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to get this month uploaders: {e}")

    # Format duration
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
    """JWT auth, admin role required."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        return await _get_dashboard_data(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Dashboard stats error: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard statistics")


@router.get("/dashboard-public")
async def get_dashboard_stats_public(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Simple ID:password auth via header."""
    expected_key = f"{ADMIN_ID}:{ADMIN_PASS}"
    if x_admin_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin credentials")
    try:
        return await _get_dashboard_data(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Dashboard stats error: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard statistics")

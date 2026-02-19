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

ADMIN_ID = "aither"
ADMIN_PASS = "hub"


async def _get_dashboard_data(db: AsyncSession) -> dict:
    """Gather all dashboard statistics. Each section uses its own try-except."""

    errors = []

    # ── Data Volume ──
    total_videos = 0
    analyzed_videos = 0
    total_duration_seconds = 0
    try:
        r = await db.execute(text("SELECT COUNT(*) FROM videos"))
        total_videos = r.scalar() or 0
    except Exception as e:
        errors.append(f"total_videos: {e}")

    try:
        r = await db.execute(text("SELECT COUNT(*) FROM videos WHERE status = 'DONE'"))
        analyzed_videos = r.scalar() or 0
    except Exception as e:
        errors.append(f"analyzed_videos: {e}")

    pending_videos = total_videos - analyzed_videos

    try:
        r = await db.execute(text("""
            SELECT COALESCE(SUM(max_sec), 0) FROM (
                SELECT video_id, MAX(
                    CASE
                        WHEN time_end IS NOT NULL
                             AND time_end != ''
                             AND time_end LIKE '%:%:%'
                        THEN CAST(SPLIT_PART(time_end, ':', 1) AS INTEGER) * 3600
                           + CAST(SPLIT_PART(time_end, ':', 2) AS INTEGER) * 60
                           + CAST(SPLIT_PART(SPLIT_PART(time_end, ':', 3), '.', 1) AS INTEGER)
                        ELSE 0
                    END
                ) as max_sec
                FROM video_phases
                GROUP BY video_id
            ) sub
        """))
        total_duration_seconds = int(r.scalar() or 0)
    except Exception as e:
        errors.append(f"duration: {e}")

    # ── Video Types ──
    screen_recording_count = 0
    clean_video_count = 0
    latest_upload = None
    try:
        r = await db.execute(text(
            "SELECT COUNT(*) FROM videos WHERE upload_type = 'screen_recording' OR upload_type IS NULL"
        ))
        screen_recording_count = r.scalar() or 0
    except Exception as e:
        errors.append(f"screen_recording: {e}")

    try:
        r = await db.execute(text(
            "SELECT COUNT(*) FROM videos WHERE upload_type = 'clean_video'"
        ))
        clean_video_count = r.scalar() or 0
    except Exception as e:
        errors.append(f"clean_video: {e}")

    if screen_recording_count == 0 and clean_video_count == 0 and total_videos > 0:
        screen_recording_count = total_videos

    try:
        r = await db.execute(text("SELECT MAX(created_at) FROM videos"))
        raw = r.scalar()
        latest_upload = str(raw) if raw else None
    except Exception as e:
        errors.append(f"latest_upload: {e}")

    # ── User Scale ──
    total_users = 0
    total_streamers = 0
    this_month_uploaders = 0
    try:
        r = await db.execute(text("SELECT COUNT(*) FROM users WHERE is_active = true"))
        total_users = r.scalar() or 0
    except Exception as e:
        errors.append(f"total_users: {e}")

    try:
        r = await db.execute(text("SELECT COUNT(DISTINCT user_id) FROM videos"))
        total_streamers = r.scalar() or 0
    except Exception as e:
        errors.append(f"streamers: {e}")

    try:
        r = await db.execute(text(
            "SELECT COUNT(DISTINCT user_id) FROM videos "
            "WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)"
        ))
        this_month_uploaders = r.scalar() or 0
    except Exception as e:
        errors.append(f"this_month: {e}")

    # Format duration
    total_hours = total_duration_seconds // 3600
    total_minutes = (total_duration_seconds % 3600) // 60

    result = {
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

    if errors:
        result["_debug_errors"] = errors
        for err in errors:
            logger.warning(f"Admin dashboard query error: {err}")

    return result


@router.get("/dashboard")
async def get_dashboard_stats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """JWT auth, admin role required."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return await _get_dashboard_data(db)


@router.get("/debug-schema")
async def debug_schema(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Temporary debug endpoint to check actual DB schema."""
    expected_key = f"{ADMIN_ID}:{ADMIN_PASS}"
    if x_admin_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin credentials")
    results = {}
    for table in ["videos", "users", "video_phases"]:
        try:
            r = await db.execute(text(
                f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position"
            ))
            results[table] = [row[0] for row in r.fetchall()]
        except Exception as e:
            results[table] = f"Error: {e}"
    # Get sample time data and row count
    try:
        r = await db.execute(text("SELECT COUNT(*) FROM video_phases"))
        results["video_phases_count"] = r.scalar()
    except Exception as e:
        results["video_phases_count"] = f"Error: {e}"
    try:
        r = await db.execute(text(
            "SELECT time_start, time_end FROM video_phases LIMIT 10"
        ))
        results["time_samples"] = [{"start": row[0], "end": row[1]} for row in r.fetchall()]
    except Exception as e:
        results["time_samples"] = f"Error: {e}"
    try:
        r = await db.execute(text(
            "SELECT time_start, time_end FROM video_phases WHERE time_end IS NOT NULL LIMIT 10"
        ))
        results["time_non_null"] = [{"start": row[0], "end": row[1]} for row in r.fetchall()]
    except Exception as e:
        results["time_non_null"] = f"Error: {e}"
    return results


@router.get("/dashboard-public")
async def get_dashboard_stats_public(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    db: AsyncSession = Depends(get_db),
):
    """Simple ID:password auth via header."""
    expected_key = f"{ADMIN_ID}:{ADMIN_PASS}"
    if x_admin_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin credentials")
    return await _get_dashboard_data(db)

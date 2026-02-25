"""
Chrome Extension API Endpoints for TikTok Shop LIVE Data

These endpoints receive real-time data from the AitherHub LIVE Connector
Chrome extension, which scrapes TikTok Shop LIVE Manager and LIVE Dashboard.

Session lifecycle is persisted in PostgreSQL (live_sessions table).
Real-time event data is kept in-memory for SSE performance.

When a live_capture session is already active for the same user,
extension data is bridged (forwarded) to that session so the
LiveDashboard shows both HLS video and extension metrics/comments.

POST /api/v1/live/extension/session/start  - Start a new extension session
POST /api/v1/live/extension/session/end    - End an extension session
POST /api/v1/live/extension/data           - Push real-time data
GET  /api/v1/live/extension/health         - Health check for extension
GET  /api/v1/live/extension/session/{session_id}/data - Get session data
GET  /api/v1/live/extension/sessions       - List sessions
"""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.db import get_db
from app.services import live_event_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live/extension", tags=["Live Extension"])


# ── Request / Response Schemas ──────────────────────────────────────

class ExtensionSessionStartRequest(BaseModel):
    event: str = "live_started"
    source: str  # 'streamer' or 'workbench'
    room_id: str = ""
    account: str = ""
    region: str = ""
    timestamp: str = ""


class ExtensionSessionStartResponse(BaseModel):
    session_id: str
    video_id: str
    message: str
    bridged_to: Optional[str] = None  # video_id of bridged live_capture session


class ExtensionDataRequest(BaseModel):
    session_id: Optional[str] = None
    source: str = ""  # 'streamer' or 'workbench'
    timestamp: str = ""
    metrics: dict = Field(default_factory=dict)
    comments: List[dict] = Field(default_factory=list)
    products: List[dict] = Field(default_factory=list)
    activities: List[dict] = Field(default_factory=list)
    traffic_sources: List[dict] = Field(default_factory=list)
    suggestions: List[dict] = Field(default_factory=list)


class ExtensionSessionEndRequest(BaseModel):
    session_id: str
    timestamp: str = ""


# ── In-memory Extension Data Store (volatile, high-frequency) ────────
# session_id -> accumulated extension data (comments, products, etc.)
_extension_data: Dict[str, dict] = {}

# session_id -> video_id mapping (in-memory cache, rebuilt from DB)
_session_to_video: Dict[str, str] = {}

# session_id -> bridged live_capture video_id (extension data forwarded here)
_session_bridge: Dict[str, str] = {}


# ── Helper: Find active live_capture session for user ────────────────

async def _find_active_live_capture(db: AsyncSession, user_id: int) -> Optional[str]:
    """
    Find an active live_capture session for the given user.
    Returns the video_id if found, None otherwise.
    """
    try:
        sessions = await live_event_service.get_active_sessions_from_db(db, user_id)
        for s in sessions:
            if s.get("session_type") == "live_capture" and s.get("is_active"):
                return s["video_id"]
    except Exception as e:
        logger.warning(f"Failed to search for active live_capture sessions: {e}")

    # Also check in-memory status
    for vid, is_active in live_event_service._live_status.items():
        if is_active and not vid.startswith("ext_"):
            return vid

    return None


# ── Endpoints ───────────────────────────────────────────────────────

@router.get("/health")
async def extension_health(db: AsyncSession = Depends(get_db)):
    """Health check endpoint for Chrome extension connection test."""
    try:
        # Count active extension sessions from DB
        active_sessions = await live_event_service.get_active_sessions_from_db(db)
        ext_count = sum(1 for s in active_sessions if s.get("session_type") == "extension")
    except Exception:
        ext_count = 0

    return {
        "status": "ok",
        "service": "aitherhub-live-extension",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "active_sessions": ext_count,
    }


@router.post("/session/start", response_model=ExtensionSessionStartResponse)
async def start_extension_session(
    request: ExtensionSessionStartRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Start a new Chrome extension session.
    Called when the extension detects a TikTok Shop LIVE page.
    Creates a virtual video_id for this extension session.
    Persists session info to PostgreSQL.

    If an active live_capture session exists for the same user,
    the extension data will be bridged to that session.
    """
    user_id = current_user["id"]

    # ── Stable room_id generation ──
    # If room_id is empty or starts with 'acct_'/'day_', use account-based stable ID
    raw_room = request.room_id or ""
    if raw_room and not raw_room.startswith("acct_") and not raw_room.startswith("day_"):
        # Real room_id from URL
        room_id = raw_room
    elif request.account:
        # Use account name for stable ID
        room_id = f"acct_{request.account}"
    else:
        # Fallback: user-level stable ID (one session per user)
        room_id = f"user_{user_id}"

    video_id = f"ext_{user_id}_{room_id}"

    # ── Check for existing active session with same video_id ──
    # If found, reuse it instead of creating a new one
    try:
        existing_sessions = await live_event_service.get_extension_sessions_from_db(
            db, user_id, active_only=True
        )
        for existing in existing_sessions:
            old_vid = existing.get("video_id", "")
            old_sid = existing.get("session_id", "")
            if old_vid == video_id and old_sid:
                # Same video_id already active - reuse this session
                logger.info(f"Reusing existing extension session: {old_sid} (video_id={video_id})")
                # Ensure in-memory state is consistent
                _session_to_video[old_sid] = video_id
                live_event_service._live_status[video_id] = True
                if old_sid not in _extension_data:
                    _extension_data[old_sid] = {
                        "comments": [], "products": [], "activities": [],
                        "traffic_sources": [], "suggestions": [],
                        "metrics_history": [], "latest_metrics": {},
                    }
                # Check bridge
                bridged_video_id = await _find_active_live_capture(db, user_id)
                if bridged_video_id:
                    _session_bridge[old_sid] = bridged_video_id
                return ExtensionSessionStartResponse(
                    session_id=old_sid,
                    video_id=video_id,
                    message=f"Reused existing session for {request.account or 'unknown'}",
                    bridged_to=bridged_video_id if bridged_video_id else None,
                )

        # Close any OTHER active extension sessions for this user
        for old_session in existing_sessions:
            old_vid = old_session.get("video_id", "")
            old_sid = old_session.get("session_id", "")
            if old_vid == video_id:
                continue
            logger.info(f"Auto-closing stale extension session: {old_vid} (sid={old_sid})")
            try:
                await live_event_service._end_session_in_db(db, old_vid)
                live_event_service._live_status[old_vid] = False
                _session_bridge.pop(old_sid, None)
                _session_to_video.pop(old_sid, None)
                _extension_data.pop(old_sid, None)
            except Exception as e:
                logger.warning(f"Failed to auto-close stale session {old_vid}: {e}")
    except Exception as e:
        logger.warning(f"Failed to check for existing sessions: {e}")

    session_id = str(uuid.uuid4())

    stream_info = {
        "source": "extension",
        "extension_source": request.source,
        "account": request.account,
        "room_id": request.room_id,
        "region": request.region,
    }

    # Check for active live_capture session to bridge data
    bridged_video_id = await _find_active_live_capture(db, user_id)
    if bridged_video_id:
        _session_bridge[session_id] = bridged_video_id
        logger.info(
            f"Extension session {session_id} will bridge data to "
            f"live_capture session {bridged_video_id}"
        )
        # Push extension_connected event to the live_capture session
        live_event_service.push_event(
            video_id=bridged_video_id,
            event_type="extension_connected",
            payload={
                "source": request.source,
                "account": request.account,
                "room_id": request.room_id,
                "region": request.region,
                "extension_session_id": session_id,
            },
        )

    # Persist to database
    await live_event_service._create_session_in_db(
        db=db,
        video_id=video_id,
        user_id=user_id,
        session_type="extension",
        account=request.account,
        source=request.source,
        room_id=request.room_id,
        region=request.region,
        ext_session_id=session_id,
        stream_info=stream_info,
    )

    # Update in-memory caches
    _session_to_video[session_id] = video_id
    _extension_data[session_id] = {
        "comments": [],
        "products": [],
        "activities": [],
        "traffic_sources": [],
        "suggestions": [],
        "metrics_history": [],
        "latest_metrics": {},
    }

    # Register with the main live_event_service so the existing
    # LiveDashboard frontend can pick it up via SSE
    live_event_service._live_status[video_id] = True
    live_event_service.push_event(
        video_id=video_id,
        event_type="stream_url",
        payload=stream_info,
    )

    logger.info(
        f"Extension session started: {session_id} "
        f"(source={request.source}, account={request.account}, "
        f"room_id={request.room_id}, bridged_to={bridged_video_id}) "
        f"[persisted to DB]"
    )

    return ExtensionSessionStartResponse(
        session_id=session_id,
        video_id=video_id,
        message=f"Session started for {request.account or 'unknown'} ({request.source})",
        bridged_to=bridged_video_id,
    )


def _bridge_event(session_id: str, event_type: str, payload: dict) -> None:
    """
    If this extension session is bridged to a live_capture session,
    forward the event to that session's SSE pipeline as well.
    """
    bridged_vid = _session_bridge.get(session_id)
    if bridged_vid and live_event_service.is_live(bridged_vid):
        live_event_service.push_event(
            video_id=bridged_vid,
            event_type=event_type,
            payload=payload,
        )


@router.post("/data")
async def push_extension_data(
    request: ExtensionDataRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Receive real-time data from the Chrome extension.
    Data includes metrics, comments, products, activities, traffic sources.
    Pushes all data into the existing SSE pipeline so the frontend
    LiveDashboard receives it automatically.

    If bridged to a live_capture session, data is also forwarded there.
    """
    session_id = request.session_id

    if not session_id or session_id not in _session_to_video:
        # Try to recover from DB if in-memory cache was lost
        if session_id:
            session_data = await _recover_session_from_db(db, session_id, current_user["id"])
            if session_data:
                logger.info(f"Recovered extension session from DB: {session_id}")
            else:
                raise HTTPException(
                    status_code=404,
                    detail="Session not found. Start a session first.",
                )
        else:
            raise HTTPException(
                status_code=404,
                detail="Session not found. Start a session first.",
            )

    video_id = _session_to_video[session_id]

    # If not yet bridged, check if a live_capture session has started since
    if session_id not in _session_bridge:
        bridged_vid = await _find_active_live_capture(db, current_user["id"])
        if bridged_vid:
            _session_bridge[session_id] = bridged_vid
            logger.info(f"Late bridge: extension {session_id} -> {bridged_vid}")
            live_event_service.push_event(
                video_id=bridged_vid,
                event_type="extension_connected",
                payload={"extension_session_id": session_id},
            )

    # Ensure in-memory data store exists
    if session_id not in _extension_data:
        _extension_data[session_id] = {
            "comments": [],
            "products": [],
            "activities": [],
            "traffic_sources": [],
            "suggestions": [],
            "metrics_history": [],
            "latest_metrics": {},
        }

    ext_data = _extension_data[session_id]

    # Track last update time for auto-cleanup
    ext_data["_last_update"] = time.time()

    # ── Process Metrics ──
    if request.metrics:
        ext_data["latest_metrics"] = request.metrics
        ext_data["metrics_history"].append(
            {
                "timestamp": request.timestamp
                or datetime.now(timezone.utc).isoformat(),
                "metrics": request.metrics,
            }
        )
        # Keep last 500 snapshots
        if len(ext_data["metrics_history"]) > 500:
            ext_data["metrics_history"] = ext_data["metrics_history"][-500:]

        metrics_payload = {"source": "extension", **request.metrics}

        # Push to extension session's SSE pipeline
        live_event_service.push_event(
            video_id=video_id,
            event_type="metrics",
            payload=metrics_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "metrics", metrics_payload)

        # Periodically persist metrics to DB (every 10th update)
        if len(ext_data["metrics_history"]) % 10 == 0:
            try:
                await live_event_service._update_metrics_in_db(
                    db, video_id, request.metrics
                )
            except Exception as e:
                logger.warning(f"Failed to persist metrics to DB: {e}")

    # ── Process Comments ──
    if request.comments:
        for comment in request.comments:
            ext_data["comments"].append(comment)
        if len(ext_data["comments"]) > 2000:
            ext_data["comments"] = ext_data["comments"][-2000:]

        comments_payload = {
            "comments": request.comments,
            "total_count": len(ext_data["comments"]),
        }

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_comments",
            payload=comments_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "extension_comments", comments_payload)

    # ── Process Products ──
    if request.products:
        ext_data["products"] = request.products  # Replace with latest snapshot

        products_payload = {
            "products": request.products,
            "count": len(request.products),
        }

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_products",
            payload=products_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "extension_products", products_payload)

    # ── Process Activities ──
    if request.activities:
        for activity in request.activities:
            ext_data["activities"].append(activity)
        if len(ext_data["activities"]) > 1000:
            ext_data["activities"] = ext_data["activities"][-1000:]

        activities_payload = {
            "activities": request.activities,
            "total_count": len(ext_data["activities"]),
        }

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_activities",
            payload=activities_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "extension_activities", activities_payload)

    # ── Process Traffic Sources ──
    if request.traffic_sources:
        ext_data["traffic_sources"] = request.traffic_sources

        traffic_payload = {"traffic_sources": request.traffic_sources}

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_traffic",
            payload=traffic_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "extension_traffic", traffic_payload)

    # ── Process Suggestions ──
    if request.suggestions:
        ext_data["suggestions"] = request.suggestions

        suggestions_payload = {"suggestions": request.suggestions}

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_suggestions",
            payload=suggestions_payload,
        )

        # Bridge to live_capture session
        _bridge_event(session_id, "extension_suggestions", suggestions_payload)

    return {
        "status": "ok",
        "bridged_to": _session_bridge.get(session_id),
        "processed": {
            "metrics": bool(request.metrics),
            "comments": len(request.comments),
            "products": len(request.products),
            "activities": len(request.activities),
            "traffic_sources": len(request.traffic_sources),
            "suggestions": len(request.suggestions),
        },
    }


@router.post("/session/end")
async def end_extension_session(
    request: ExtensionSessionEndRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """End a Chrome extension session. Persists end state to DB."""
    session_id = request.session_id

    video_id = _session_to_video.get(session_id)

    if not video_id:
        # Try to recover from DB
        session_data = await _recover_session_from_db(db, session_id, current_user["id"])
        if session_data:
            video_id = _session_to_video.get(session_id)
        else:
            raise HTTPException(status_code=404, detail="Session not found.")

    # End session in DB
    try:
        await live_event_service._end_session_in_db(db, video_id)
    except Exception as e:
        logger.error(f"Failed to end session in DB: {e}")

    # Notify bridged session that extension disconnected
    bridged_vid = _session_bridge.get(session_id)
    if bridged_vid:
        live_event_service.push_event(
            video_id=bridged_vid,
            event_type="extension_disconnected",
            payload={
                "message": "Chrome拡張が切断されました",
                "extension_session_id": session_id,
            },
        )

    # Update in-memory state
    if video_id:
        live_event_service.push_event(
            video_id=video_id,
            event_type="stream_ended",
            payload={
                "source": "extension",
                "message": "Chrome拡張セッションが終了しました",
                "session_summary": _get_session_summary(session_id),
            },
        )
        live_event_service._live_status[video_id] = False

    # Clean up bridge
    _session_bridge.pop(session_id, None)

    logger.info(f"Extension session ended: {session_id} [persisted to DB]")

    return {"status": "ok", "summary": _get_session_summary(session_id)}


@router.get("/session/{session_id}/data")
async def get_extension_session_data(
    session_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get accumulated data for an extension session."""
    video_id = _session_to_video.get(session_id)

    if not video_id:
        # Try to recover from DB
        session_data = await _recover_session_from_db(db, session_id, current_user["id"])
        if not session_data:
            raise HTTPException(status_code=404, detail="Session not found.")
        video_id = _session_to_video.get(session_id)

    # Get session info from DB
    session_info = await live_event_service.get_session_from_db(db, video_id) if video_id else {}
    ext_data = _extension_data.get(session_id, {})

    return {
        "session": session_info or {"session_id": session_id, "video_id": video_id},
        "data": {
            "latest_metrics": ext_data.get("latest_metrics", {}),
            "comments_count": len(ext_data.get("comments", [])),
            "recent_comments": ext_data.get("comments", [])[-50:],
            "products": ext_data.get("products", []),
            "recent_activities": ext_data.get("activities", [])[-50:],
            "traffic_sources": ext_data.get("traffic_sources", []),
            "suggestions": ext_data.get("suggestions", []),
        },
    }


@router.get("/sessions")
async def list_extension_sessions(
    active_only: bool = Query(True),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all extension sessions for the current user from DB."""
    user_id = current_user["id"]

    sessions = await live_event_service.get_extension_sessions_from_db(
        db, user_id, active_only
    )

    # Enrich with in-memory data summaries
    for session in sessions:
        sid = session.get("session_id")
        if sid and sid in _extension_data:
            session["data_summary"] = _get_session_summary(sid)
        else:
            session["data_summary"] = {
                "total_comments": 0,
                "total_products": 0,
                "total_activities": 0,
                "metrics_snapshots": 0,
                "latest_metrics": session.get("latest_metrics", {}),
            }
        # Include bridge info
        session["bridged_to"] = _session_bridge.get(sid)

    return {"sessions": sessions, "count": len(sessions)}


# ── Helper Functions ────────────────────────────────────────────────

async def _recover_session_from_db(
    db: AsyncSession, session_id: str, user_id: int
) -> Optional[dict]:
    """
    Try to recover a session from DB when in-memory cache is lost.
    This handles the case where the backend restarted mid-session.
    """
    try:
        from app.models.orm.live_session import LiveSession
        from sqlalchemy import select

        result = await db.execute(
            select(LiveSession).where(LiveSession.ext_session_id == session_id)
        )
        session = result.scalar_one_or_none()

        if session and session.user_id == user_id:
            # Rebuild in-memory cache
            _session_to_video[session_id] = session.video_id
            _extension_data[session_id] = {
                "comments": [],
                "products": [],
                "activities": [],
                "traffic_sources": [],
                "suggestions": [],
                "metrics_history": [],
                "latest_metrics": session.latest_metrics or {},
            }
            live_event_service._live_status[session.video_id] = session.is_active
            if session.stream_info:
                live_event_service._live_stream_info[session.video_id] = session.stream_info

            # Also try to recover bridge
            bridged_vid = await _find_active_live_capture(db, user_id)
            if bridged_vid:
                _session_bridge[session_id] = bridged_vid

            return {
                "session_id": session_id,
                "video_id": session.video_id,
                "account": session.account,
                "source": session.source,
            }
    except Exception as e:
        logger.warning(f"Failed to recover session from DB: {e}")

    return None


def _get_session_summary(session_id: str) -> dict:
    """Get a summary of accumulated data for a session."""
    ext_data = _extension_data.get(session_id, {})
    return {
        "total_comments": len(ext_data.get("comments", [])),
        "total_products": len(ext_data.get("products", [])),
        "total_activities": len(ext_data.get("activities", [])),
        "metrics_snapshots": len(ext_data.get("metrics_history", [])),
        "latest_metrics": ext_data.get("latest_metrics", {}),
    }


@router.post("/sessions/cleanup")
async def cleanup_stale_sessions(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Clean up all stale extension sessions for the current user.
    Keeps only the most recent active session (if any) and ends all others.
    """
    user_id = current_user["id"]

    sessions = await live_event_service.get_extension_sessions_from_db(
        db, user_id, active_only=True
    )

    if len(sessions) <= 1:
        return {"cleaned": 0, "remaining": len(sessions)}

    # Sort by started_at descending, keep the newest
    sessions.sort(key=lambda s: s.get("started_at", "") or "", reverse=True)
    newest = sessions[0]
    stale = sessions[1:]

    cleaned = 0
    for old_session in stale:
        old_vid = old_session.get("video_id", "")
        old_sid = old_session.get("session_id", "")
        try:
            await live_event_service._end_session_in_db(db, old_vid)
            live_event_service._live_status[old_vid] = False
            _session_bridge.pop(old_sid, None)
            _session_to_video.pop(old_sid, None)
            _extension_data.pop(old_sid, None)
            cleaned += 1
            logger.info(f"Cleaned up stale session: {old_vid}")
        except Exception as e:
            logger.warning(f"Failed to clean up session {old_vid}: {e}")

    return {
        "cleaned": cleaned,
        "remaining": 1,
        "active_session": {
            "video_id": newest.get("video_id"),
            "account": newest.get("account"),
        },
    }


# ── Background Cleanup Task ──────────────────────────────────────────
# Auto-close extension sessions that haven't received data in over 1 hour

import asyncio
from contextlib import suppress

_cleanup_task = None


async def _auto_cleanup_stale_sessions():
    """
    Background task that runs every 10 minutes to clean up
    extension sessions that haven't been updated in over 1 hour.
    """
    while True:
        try:
            await asyncio.sleep(600)  # Run every 10 minutes

            now = time.time()
            stale_sessions = []

            for sid, data in list(_extension_data.items()):
                last_update = data.get("_last_update", 0)
                if last_update > 0 and (now - last_update) > 3600:  # 1 hour
                    stale_sessions.append(sid)

            for sid in stale_sessions:
                vid = _session_to_video.get(sid)
                if vid:
                    logger.info(f"Auto-cleanup: closing stale session {vid} (no data for >1h)")
                    live_event_service._live_status[vid] = False
                _session_bridge.pop(sid, None)
                _session_to_video.pop(sid, None)
                _extension_data.pop(sid, None)

            if stale_sessions:
                logger.info(f"Auto-cleanup: removed {len(stale_sessions)} stale sessions")

        except Exception as e:
            logger.warning(f"Auto-cleanup task error: {e}")


def start_cleanup_task():
    """Start the background cleanup task. Call this from app startup."""
    global _cleanup_task
    if _cleanup_task is None:
        _cleanup_task = asyncio.create_task(_auto_cleanup_stale_sessions())
        logger.info("Started background session cleanup task")


def stop_cleanup_task():
    """Stop the background cleanup task. Call this from app shutdown."""
    global _cleanup_task
    if _cleanup_task:
        _cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            pass
        _cleanup_task = None
        logger.info("Stopped background session cleanup task")

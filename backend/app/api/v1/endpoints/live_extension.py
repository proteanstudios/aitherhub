"""
Chrome Extension API Endpoints for TikTok Shop LIVE Data

These endpoints receive real-time data from the AitherHub LIVE Connector
Chrome extension, which scrapes TikTok Shop LIVE Manager and LIVE Dashboard.

Session lifecycle is persisted in PostgreSQL (live_sessions table).
Real-time event data is kept in-memory for SSE performance.

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
    """
    session_id = str(uuid.uuid4())

    # Create a virtual video_id for this extension session
    user_id = current_user["id"]
    room_id = request.room_id or str(int(time.time()))
    video_id = f"ext_{user_id}_{room_id}"

    stream_info = {
        "source": "extension",
        "extension_source": request.source,
        "account": request.account,
        "room_id": request.room_id,
        "region": request.region,
    }

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
        f"room_id={request.room_id}) [persisted to DB]"
    )

    return ExtensionSessionStartResponse(
        session_id=session_id,
        video_id=video_id,
        message=f"Session started for {request.account or 'unknown'} ({request.source})",
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

        # Push to main SSE pipeline
        live_event_service.push_event(
            video_id=video_id,
            event_type="metrics",
            payload={"source": "extension", **request.metrics},
        )

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

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_comments",
            payload={
                "comments": request.comments,
                "total_count": len(ext_data["comments"]),
            },
        )

    # ── Process Products ──
    if request.products:
        ext_data["products"] = request.products  # Replace with latest snapshot

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_products",
            payload={
                "products": request.products,
                "count": len(request.products),
            },
        )

    # ── Process Activities ──
    if request.activities:
        for activity in request.activities:
            ext_data["activities"].append(activity)
        if len(ext_data["activities"]) > 1000:
            ext_data["activities"] = ext_data["activities"][-1000:]

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_activities",
            payload={
                "activities": request.activities,
                "total_count": len(ext_data["activities"]),
            },
        )

    # ── Process Traffic Sources ──
    if request.traffic_sources:
        ext_data["traffic_sources"] = request.traffic_sources

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_traffic",
            payload={"traffic_sources": request.traffic_sources},
        )

    # ── Process Suggestions ──
    if request.suggestions:
        ext_data["suggestions"] = request.suggestions

        live_event_service.push_event(
            video_id=video_id,
            event_type="extension_suggestions",
            payload={"suggestions": request.suggestions},
        )

    return {
        "status": "ok",
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

        if not session or not session.is_active:
            return None

        # Rebuild in-memory caches
        _session_to_video[session_id] = session.video_id
        live_event_service._live_status[session.video_id] = True

        if session.stream_info:
            live_event_service._live_stream_info[session.video_id] = session.stream_info

        if session.latest_metrics:
            live_event_service._live_metrics[session.video_id] = session.latest_metrics

        if session_id not in _extension_data:
            _extension_data[session_id] = {
                "comments": [],
                "products": [],
                "activities": [],
                "traffic_sources": [],
                "suggestions": [],
                "metrics_history": [],
                "latest_metrics": session.latest_metrics or {},
            }

        return {
            "session_id": session_id,
            "video_id": session.video_id,
            "active": session.is_active,
        }
    except Exception as e:
        logger.warning(f"Failed to recover session from DB (table may not exist): {e}")
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

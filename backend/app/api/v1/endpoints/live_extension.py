"""
Chrome Extension API Endpoints for TikTok Shop LIVE Data

These endpoints receive real-time data from the AitherHub LIVE Connector
Chrome extension, which scrapes TikTok Shop LIVE Manager and LIVE Dashboard.

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

from app.core.dependencies import get_current_user
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


# ── In-memory Extension Session Store ───────────────────────────────

# session_id -> session info
_extension_sessions: Dict[str, dict] = {}

# session_id -> video_id mapping
_session_to_video: Dict[str, str] = {}

# session_id -> accumulated extension data
_extension_data: Dict[str, dict] = {}


# ── Endpoints ───────────────────────────────────────────────────────

@router.get("/health")
async def extension_health():
    """Health check endpoint for Chrome extension connection test."""
    return {
        "status": "ok",
        "service": "aitherhub-live-extension",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "active_sessions": len(
            [s for s in _extension_sessions.values() if s.get("active")]
        ),
    }


@router.post("/session/start", response_model=ExtensionSessionStartResponse)
async def start_extension_session(
    request: ExtensionSessionStartRequest,
    current_user=Depends(get_current_user),
):
    """
    Start a new Chrome extension session.
    Called when the extension detects a TikTok Shop LIVE page.
    Creates a virtual video_id for this extension session.
    """
    session_id = str(uuid.uuid4())

    # Create a virtual video_id for this extension session
    user_id = current_user["id"]
    room_id = request.room_id or str(int(time.time()))
    video_id = f"ext_{user_id}_{room_id}"

    session_info = {
        "session_id": session_id,
        "video_id": video_id,
        "user_id": user_id,
        "source": request.source,
        "room_id": request.room_id,
        "account": request.account,
        "region": request.region,
        "started_at": request.timestamp or datetime.now(timezone.utc).isoformat(),
        "active": True,
    }

    _extension_sessions[session_id] = session_info
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
        payload={
            "source": "extension",
            "extension_source": request.source,
            "account": request.account,
            "room_id": request.room_id,
            "region": request.region,
        },
    )

    logger.info(
        f"Extension session started: {session_id} "
        f"(source={request.source}, account={request.account}, "
        f"room_id={request.room_id})"
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
):
    """
    Receive real-time data from the Chrome extension.
    Data includes metrics, comments, products, activities, traffic sources.
    Pushes all data into the existing SSE pipeline so the frontend
    LiveDashboard receives it automatically.
    """
    session_id = request.session_id

    if not session_id or session_id not in _extension_sessions:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Start a session first.",
        )

    session = _extension_sessions[session_id]
    if not session.get("active"):
        raise HTTPException(status_code=410, detail="Session has ended.")

    video_id = _session_to_video[session_id]
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
):
    """End a Chrome extension session."""
    session_id = request.session_id

    if session_id not in _extension_sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    session = _extension_sessions[session_id]
    session["active"] = False
    session["ended_at"] = (
        request.timestamp or datetime.now(timezone.utc).isoformat()
    )

    video_id = _session_to_video.get(session_id)
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

    logger.info(f"Extension session ended: {session_id}")

    return {"status": "ok", "summary": _get_session_summary(session_id)}


@router.get("/session/{session_id}/data")
async def get_extension_session_data(
    session_id: str,
    current_user=Depends(get_current_user),
):
    """Get accumulated data for an extension session."""
    if session_id not in _extension_sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    session = _extension_sessions[session_id]
    ext_data = _extension_data.get(session_id, {})

    return {
        "session": session,
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
):
    """List all extension sessions for the current user."""
    user_id = current_user["id"]
    sessions = []

    for sid, session in _extension_sessions.items():
        if session.get("user_id") != user_id:
            continue
        if active_only and not session.get("active"):
            continue
        sessions.append({**session, "data_summary": _get_session_summary(sid)})

    return {"sessions": sessions, "count": len(sessions)}


# ── Helper Functions ────────────────────────────────────────────────

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

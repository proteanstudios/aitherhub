"""
Real-time Live Monitoring API Endpoints

POST /api/v1/live/{video_id}/events       - Worker pushes events (metrics, advice, stream_url)
GET  /api/v1/live/{video_id}/stream       - Frontend subscribes to SSE stream
GET  /api/v1/live/{video_id}/status       - Get current live status
GET  /api/v1/live/active                  - List all active live sessions
POST /api/v1/live/{video_id}/start-monitor - Start real-time monitoring for a live capture

Session lifecycle is persisted in PostgreSQL (live_sessions table).
Real-time event data is kept in-memory for SSE performance.
"""

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.db import get_db
from app.services import live_event_service

# Internal API key for worker-to-backend communication
WORKER_API_KEY = os.getenv("WORKER_API_KEY", "aitherhub-worker-internal-key-2026")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live", tags=["Live Monitoring"])


# ── Request / Response schemas ───────────────────────────────────────

class LiveEventRequest(BaseModel):
    event_type: str  # metrics | advice | stream_url | stream_ended
    payload: dict


class LiveStatusResponse(BaseModel):
    video_id: str
    is_live: bool
    stream_info: Optional[dict] = None
    latest_metrics: Optional[dict] = None
    session_type: Optional[str] = None
    account: Optional[str] = None


class StartMonitorRequest(BaseModel):
    live_url: str
    video_id: str


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/{video_id}/events")
async def push_live_event(
    video_id: str,
    request: LiveEventRequest,
    x_worker_key: Optional[str] = Header(None),
):
    """
    Worker pushes real-time events to the backend.
    Protected by internal API key (no user auth required).
    Event types:
    - metrics: viewer count, comments, gifts, likes
    - advice: AI-generated advice with urgency level
    - stream_url: HLS/FLV stream URL for frontend playback
    - stream_ended: notification that the live stream has ended
    """
    if x_worker_key != WORKER_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid worker API key")

    try:
        live_event_service.push_event(
            video_id=video_id,
            event_type=request.event_type,
            payload=request.payload,
        )

        # Persist stream_ended to DB
        if request.event_type == "stream_ended":
            try:
                from app.core.db import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    await live_event_service._end_session_in_db(db, video_id)
                    logger.info(f"Session {video_id} marked as ended in DB")
            except Exception as e:
                logger.warning(f"Failed to persist stream_ended to DB: {e}")

        # Persist metrics periodically to DB
        if request.event_type == "metrics":
            try:
                from app.core.db import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    await live_event_service._update_metrics_in_db(
                        db, video_id, request.payload
                    )
            except Exception as e:
                logger.warning(f"Failed to persist metrics to DB: {e}")

        # Persist stream_url to DB
        if request.event_type == "stream_url":
            try:
                from app.core.db import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    await live_event_service._update_stream_info_in_db(
                        db, video_id, request.payload
                    )
            except Exception as e:
                logger.warning(f"Failed to persist stream_url to DB: {e}")

        return {"success": True, "event_type": request.event_type}
    except Exception as e:
        logger.error(f"Failed to push live event: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{video_id}/stream")
async def stream_live_events(
    video_id: str,
    current_user=Depends(get_current_user),
):
    """
    SSE endpoint for frontend to receive real-time live events.
    Sends:
    - metrics updates (every 5 seconds)
    - AI advice (when triggered)
    - stream URL (once, at start)
    - stream ended notification
    """
    async def event_generator():
        last_event_ts = time.time() - 60  # Get events from last 60 seconds
        notify = live_event_service.subscribe(video_id)
        stream_ended_received = False
        grace_start = time.time()
        GRACE_PERIOD = 120  # 2 minutes grace period

        try:
            # Send initial state if available
            stream_info = live_event_service.get_stream_info(video_id)
            if stream_info:
                yield f"data: {json.dumps({'event_type': 'stream_url', 'payload': stream_info})}\n\n"

            latest_metrics = live_event_service.get_latest_metrics(video_id)
            if latest_metrics:
                yield f"data: {json.dumps({'event_type': 'metrics', 'payload': latest_metrics})}\n\n"

            heartbeat_count = 0
            while True:
                try:
                    await asyncio.wait_for(notify.wait(), timeout=5.0)
                    notify.clear()
                except asyncio.TimeoutError:
                    pass

                events = live_event_service.get_events_since(video_id, last_event_ts)
                for event in events:
                    yield f"data: {json.dumps({'event_type': event['event_type'], 'payload': event['payload']})}\n\n"
                    last_event_ts = event["timestamp"]
                    if event["event_type"] == "stream_ended":
                        stream_ended_received = True

                if stream_ended_received:
                    break

                elapsed = time.time() - grace_start
                if elapsed > GRACE_PERIOD and not live_event_service.is_live(video_id):
                    if live_event_service.get_latest_metrics(video_id) is not None:
                        yield f"data: {json.dumps({'event_type': 'stream_ended', 'payload': {'message': 'ライブ配信が終了しました'}})}\n\n"
                        break

                heartbeat_count += 1
                if heartbeat_count % 3 == 0:
                    yield f"data: {json.dumps({'event_type': 'heartbeat', 'payload': {'timestamp': datetime.now(timezone.utc).isoformat()}})}\n\n"

        except asyncio.CancelledError:
            pass
        finally:
            live_event_service.unsubscribe(video_id, notify)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{video_id}/status")
async def get_live_status(
    video_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get current live monitoring status for a video.
    First checks in-memory, then falls back to DB.
    """
    # Check in-memory first (fastest)
    is_live = live_event_service.is_live(video_id)
    stream_info = live_event_service.get_stream_info(video_id)
    latest_metrics = live_event_service.get_latest_metrics(video_id)

    session_type = None
    account = None

    # If not found in-memory, check DB
    if not is_live:
        session = await live_event_service.get_session_from_db(db, video_id)
        if session and session.get("is_active"):
            is_live = True
            stream_info = stream_info or session.get("stream_info")
            latest_metrics = latest_metrics or session.get("latest_metrics")
            session_type = session.get("session_type")
            account = session.get("account")

            # Restore to in-memory cache
            live_event_service._live_status[video_id] = True
            if stream_info:
                live_event_service._live_stream_info[video_id] = stream_info
            if latest_metrics:
                live_event_service._live_metrics[video_id] = latest_metrics
    else:
        # Get additional info from stream_info
        if stream_info:
            account = stream_info.get("account") or stream_info.get("username")

    return {
        "video_id": video_id,
        "is_live": is_live,
        "stream_info": stream_info,
        "latest_metrics": latest_metrics,
        "session_type": session_type,
        "account": account,
    }


@router.get("/active")
async def get_active_sessions(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all currently active live monitoring sessions.
    Merges in-memory sessions with DB sessions for completeness.
    """
    # Get in-memory sessions
    memory_sessions = live_event_service.get_active_live_sessions()
    memory_video_ids = {s["video_id"] for s in memory_sessions}

    # Get DB sessions for this user
    user_id = current_user["id"]
    db_sessions = await live_event_service.get_active_sessions_from_db(db, user_id)

    # Merge: add DB sessions not already in memory
    merged = list(memory_sessions)
    for db_s in db_sessions:
        if db_s["video_id"] not in memory_video_ids:
            merged.append({
                "video_id": db_s["video_id"],
                "stream_info": db_s.get("stream_info", {}),
                "latest_metrics": db_s.get("latest_metrics", {}),
                "session_type": db_s.get("session_type"),
                "account": db_s.get("account"),
                "source": "db",  # Indicate this was recovered from DB
            })

    return {"sessions": merged, "count": len(merged)}


@router.post("/{video_id}/start-monitor")
async def start_live_monitor(
    video_id: str,
    request: StartMonitorRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Start real-time monitoring for a live capture.
    Enqueues a live_monitor job for the worker.
    Persists session to DB.
    """
    from app.services.queue_service import enqueue_job

    try:
        # Extract username from URL
        match = re.search(r"@([^/]+)", request.live_url)
        username = match.group(1) if match else "unknown"

        # Persist session to DB
        await live_event_service._create_session_in_db(
            db=db,
            video_id=video_id,
            user_id=current_user["id"],
            session_type="live_capture",
            account=username,
            live_url=request.live_url,
            stream_info={
                "username": username,
                "live_url": request.live_url,
            },
        )

        # Mark as live in-memory
        live_event_service._live_status[video_id] = True

        # Enqueue monitor job
        queue_payload = {
            "job_type": "live_monitor",
            "video_id": video_id,
            "live_url": request.live_url,
            "username": username,
            "user_id": current_user["id"],
        }
        await enqueue_job(queue_payload)

        logger.info(
            f"Live monitor started: {video_id} for @{username} [persisted to DB]"
        )

        return {
            "success": True,
            "video_id": video_id,
            "message": f"Real-time monitoring started for @{username}",
        }
    except Exception as e:
        logger.error(f"Failed to start live monitor: {e}")
        raise HTTPException(status_code=500, detail=str(e))

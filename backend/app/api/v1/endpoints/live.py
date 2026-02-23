"""
Real-time Live Monitoring API Endpoints

POST /api/v1/live/{video_id}/events       - Worker pushes events (metrics, advice, stream_url)
GET  /api/v1/live/{video_id}/stream       - Frontend subscribes to SSE stream
GET  /api/v1/live/{video_id}/status       - Get current live status
GET  /api/v1/live/active                  - List all active live sessions
POST /api/v1/live/{video_id}/start-monitor - Start real-time monitoring for a live capture
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import os

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.dependencies import get_current_user
from app.services import live_event_service

# Internal API key for worker-to-backend communication
# Falls back to a default for development
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
        # Grace period: don't check is_live() until we've waited at least 60 seconds
        # This prevents premature stream_ended when the monitor hasn't started yet
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
                # Wait for new events or timeout (for heartbeat)
                try:
                    await asyncio.wait_for(notify.wait(), timeout=5.0)
                    notify.clear()
                except asyncio.TimeoutError:
                    pass

                # Send new events
                events = live_event_service.get_events_since(video_id, last_event_ts)
                for event in events:
                    yield f"data: {json.dumps({'event_type': event['event_type'], 'payload': event['payload']})}\n\n"
                    last_event_ts = event["timestamp"]
                    # Only end if we explicitly received a stream_ended event from the worker
                    if event["event_type"] == "stream_ended":
                        stream_ended_received = True

                if stream_ended_received:
                    break

                # After grace period, check if stream is marked as ended
                elapsed = time.time() - grace_start
                if elapsed > GRACE_PERIOD and not live_event_service.is_live(video_id):
                    # Double check: only end if there have been events before
                    # (if no events ever arrived, the monitor may not have started yet)
                    if live_event_service.get_latest_metrics(video_id) is not None:
                        yield f"data: {json.dumps({'event_type': 'stream_ended', 'payload': {'message': 'ライブ配信が終了しました'}})}\n\n"
                        break

                # Heartbeat every 15 seconds (more frequent for connection keepalive)
                heartbeat_count += 1
                if heartbeat_count % 3 == 0:  # 3 * 5 seconds = 15 seconds
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


@router.get("/{video_id}/status", response_model=LiveStatusResponse)
async def get_live_status(
    video_id: str,
    current_user=Depends(get_current_user),
):
    """Get current live monitoring status for a video."""
    return LiveStatusResponse(
        video_id=video_id,
        is_live=live_event_service.is_live(video_id),
        stream_info=live_event_service.get_stream_info(video_id),
        latest_metrics=live_event_service.get_latest_metrics(video_id),
    )


@router.get("/active")
async def get_active_sessions(
    current_user=Depends(get_current_user),
):
    """List all currently active live monitoring sessions."""
    sessions = live_event_service.get_active_live_sessions()
    return {"sessions": sessions, "count": len(sessions)}


@router.post("/{video_id}/start-monitor")
async def start_live_monitor(
    video_id: str,
    request: StartMonitorRequest,
    current_user=Depends(get_current_user),
):
    """
    Start real-time monitoring for a live capture.
    Enqueues a live_monitor job for the worker.
    """
    from app.services.queue_service import enqueue_job

    try:
        # Mark as live
        live_event_service._live_status[video_id] = True

        # Extract username from URL
        import re
        match = re.search(r"@([^/]+)", request.live_url)
        username = match.group(1) if match else "unknown"

        # Enqueue monitor job (no auth_token - worker uses WORKER_API_KEY)
        queue_payload = {
            "job_type": "live_monitor",
            "video_id": video_id,
            "live_url": request.live_url,
            "username": username,
            "user_id": current_user["id"],
        }
        await enqueue_job(queue_payload)

        return {
            "success": True,
            "video_id": video_id,
            "message": f"Real-time monitoring started for @{username}",
        }
    except Exception as e:
        logger.error(f"Failed to start live monitor: {e}")
        raise HTTPException(status_code=500, detail=str(e))

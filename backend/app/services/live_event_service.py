"""
In-memory store for real-time live events.
Worker pushes events via POST /api/v1/live/{video_id}/events
Frontend consumes events via GET /api/v1/live/{video_id}/stream (SSE)
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── In-memory event store ────────────────────────────────────────────
# video_id -> deque of events
_live_events: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))

# video_id -> latest metrics snapshot
_live_metrics: Dict[str, dict] = {}

# video_id -> latest stream info (stream_url, username, etc.)
_live_stream_info: Dict[str, dict] = {}

# video_id -> list of asyncio.Event objects for SSE subscribers
_live_subscribers: Dict[str, list] = defaultdict(list)

# video_id -> is_live flag
_live_status: Dict[str, bool] = {}

# Maximum age for events (10 minutes)
MAX_EVENT_AGE = 600


def push_event(video_id: str, event_type: str, payload: dict) -> None:
    """Push a new event from the worker."""
    event = {
        "event_type": event_type,
        "payload": payload,
        "timestamp": time.time(),
    }
    _live_events[video_id].append(event)

    # Update specific stores based on event type
    if event_type == "metrics":
        _live_metrics[video_id] = payload
    elif event_type == "stream_url":
        _live_stream_info[video_id] = payload
        _live_status[video_id] = True
    elif event_type == "stream_ended":
        _live_status[video_id] = False

    # Notify all SSE subscribers
    for notify_event in _live_subscribers.get(video_id, []):
        notify_event.set()


def get_latest_metrics(video_id: str) -> Optional[dict]:
    """Get the latest metrics snapshot for a video."""
    return _live_metrics.get(video_id)


def get_stream_info(video_id: str) -> Optional[dict]:
    """Get stream info (URL, username) for a video."""
    return _live_stream_info.get(video_id)


def is_live(video_id: str) -> bool:
    """Check if a video is currently being monitored live."""
    return _live_status.get(video_id, False)


def get_events_since(video_id: str, since_ts: float) -> list:
    """Get all events since a given timestamp."""
    events = _live_events.get(video_id, deque())
    return [e for e in events if e["timestamp"] > since_ts]


def subscribe(video_id: str) -> asyncio.Event:
    """Subscribe to live events for a video. Returns an asyncio.Event to wait on."""
    notify = asyncio.Event()
    _live_subscribers[video_id].append(notify)
    return notify


def unsubscribe(video_id: str, notify: asyncio.Event) -> None:
    """Unsubscribe from live events."""
    subs = _live_subscribers.get(video_id, [])
    if notify in subs:
        subs.remove(notify)
    # Clean up empty subscriber lists
    if not subs and video_id in _live_subscribers:
        del _live_subscribers[video_id]


def cleanup_video(video_id: str) -> None:
    """Clean up all data for a video that's no longer live."""
    _live_events.pop(video_id, None)
    _live_metrics.pop(video_id, None)
    _live_stream_info.pop(video_id, None)
    _live_status.pop(video_id, None)
    _live_subscribers.pop(video_id, None)


def get_active_live_sessions() -> list:
    """Get all currently active live monitoring sessions."""
    return [
        {
            "video_id": vid,
            "stream_info": _live_stream_info.get(vid, {}),
            "latest_metrics": _live_metrics.get(vid, {}),
        }
        for vid, is_active in _live_status.items()
        if is_active
    ]

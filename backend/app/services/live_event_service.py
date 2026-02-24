"""
Hybrid live event service: PostgreSQL persistence + in-memory cache.

Session lifecycle (start/end/active status) is persisted in the
`live_sessions` table so it survives backend restarts and works
across multiple App Service instances.

High-frequency data (SSE events, real-time metrics, subscriber
notifications) stays in-memory for performance.

Worker pushes events via POST /api/v1/live/{video_id}/events
Frontend consumes events via GET /api/v1/live/{video_id}/stream (SSE)

NOTE: All DB operations use try-except fallback so the service
works even before the live_sessions migration has been applied.
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── In-memory caches (volatile, rebuilt from DB + live data) ──────────
# video_id -> deque of events
_live_events: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))

# video_id -> latest metrics snapshot
_live_metrics: Dict[str, dict] = {}

# video_id -> latest stream info (stream_url, username, etc.)
_live_stream_info: Dict[str, dict] = {}

# video_id -> list of asyncio.Event objects for SSE subscribers
_live_subscribers: Dict[str, list] = defaultdict(list)

# video_id -> is_live flag (in-memory mirror of DB is_active)
_live_status: Dict[str, bool] = {}

# Maximum age for events (10 minutes)
MAX_EVENT_AGE = 600

# Flag to track if DB table is available
_db_available = True


def _import_model():
    """Lazy import of LiveSession model to avoid circular imports."""
    try:
        from app.models.orm.live_session import LiveSession
        return LiveSession
    except Exception:
        return None


# ── DB helper functions (all with try-except fallback) ─────────────

async def _create_session_in_db(
    db: AsyncSession,
    video_id: str,
    user_id: int,
    session_type: str,
    account: Optional[str] = None,
    live_url: Optional[str] = None,
    source: Optional[str] = None,
    room_id: Optional[str] = None,
    region: Optional[str] = None,
    ext_session_id: Optional[str] = None,
    stream_info: Optional[dict] = None,
) -> None:
    """Create or update a live session record in the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        logger.debug("DB not available, skipping session creation")
        return

    try:
        # Check if session already exists (e.g., reconnection)
        result = await db.execute(
            select(LiveSession).where(LiveSession.video_id == video_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Reactivate existing session
            existing.is_active = True
            existing.account = account or existing.account
            existing.live_url = live_url or existing.live_url
            existing.source = source or existing.source
            existing.room_id = room_id or existing.room_id
            existing.region = region or existing.region
            existing.ext_session_id = ext_session_id or existing.ext_session_id
            existing.stream_info = stream_info or existing.stream_info
            existing.ended_at = None
        else:
            new_session = LiveSession(
                video_id=video_id,
                user_id=user_id,
                session_type=session_type,
                is_active=True,
                account=account,
                live_url=live_url,
                source=source,
                room_id=room_id,
                region=region,
                ext_session_id=ext_session_id,
                stream_info=stream_info,
            )
            db.add(new_session)

        await db.commit()
        logger.info(f"Session {video_id} persisted to DB (type={session_type})")
    except Exception as e:
        await db.rollback()
        _db_available = False
        logger.warning(f"DB write failed for session {video_id} (table may not exist): {e}")


async def _end_session_in_db(db: AsyncSession, video_id: str) -> None:
    """Mark a live session as ended in the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return

    try:
        await db.execute(
            update(LiveSession)
            .where(LiveSession.video_id == video_id)
            .values(
                is_active=False,
                ended_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
        logger.info(f"Session {video_id} marked as ended in DB")
    except Exception as e:
        await db.rollback()
        _db_available = False
        logger.warning(f"DB update failed for ending session {video_id}: {e}")


async def _update_metrics_in_db(
    db: AsyncSession, video_id: str, metrics: dict
) -> None:
    """Update latest metrics snapshot in the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return

    try:
        await db.execute(
            update(LiveSession)
            .where(LiveSession.video_id == video_id)
            .values(latest_metrics=metrics)
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        _db_available = False
        logger.warning(f"DB metrics update failed for {video_id}: {e}")


async def _update_stream_info_in_db(
    db: AsyncSession, video_id: str, stream_info: dict
) -> None:
    """Update stream info in the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return

    try:
        await db.execute(
            update(LiveSession)
            .where(LiveSession.video_id == video_id)
            .values(stream_info=stream_info)
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        _db_available = False
        logger.warning(f"DB stream_info update failed for {video_id}: {e}")


async def get_active_sessions_from_db(
    db: AsyncSession, user_id: Optional[int] = None
) -> List[dict]:
    """Get all active live sessions from the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return []

    try:
        query = select(LiveSession).where(LiveSession.is_active == True)
        if user_id is not None:
            query = query.where(LiveSession.user_id == user_id)

        result = await db.execute(query)
        sessions = result.scalars().all()

        return [
            {
                "video_id": s.video_id,
                "user_id": s.user_id,
                "session_type": s.session_type,
                "account": s.account,
                "live_url": s.live_url,
                "source": s.source,
                "room_id": s.room_id,
                "region": s.region,
                "ext_session_id": s.ext_session_id,
                "stream_info": s.stream_info or {},
                "latest_metrics": s.latest_metrics or {},
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "is_active": s.is_active,
            }
            for s in sessions
        ]
    except Exception as e:
        _db_available = False
        logger.warning(f"DB query failed for active sessions: {e}")
        return []


async def get_session_from_db(
    db: AsyncSession, video_id: str
) -> Optional[dict]:
    """Get a specific session from the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return None

    try:
        result = await db.execute(
            select(LiveSession).where(LiveSession.video_id == video_id)
        )
        s = result.scalar_one_or_none()
        if not s:
            return None

        return {
            "video_id": s.video_id,
            "user_id": s.user_id,
            "session_type": s.session_type,
            "account": s.account,
            "live_url": s.live_url,
            "source": s.source,
            "room_id": s.room_id,
            "region": s.region,
            "ext_session_id": s.ext_session_id,
            "stream_info": s.stream_info or {},
            "latest_metrics": s.latest_metrics or {},
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "is_active": s.is_active,
        }
    except Exception as e:
        _db_available = False
        logger.warning(f"DB query failed for session {video_id}: {e}")
        return None


async def get_extension_sessions_from_db(
    db: AsyncSession, user_id: int, active_only: bool = True
) -> List[dict]:
    """Get extension sessions for a specific user from the database."""
    global _db_available
    LiveSession = _import_model()
    if not LiveSession or not _db_available:
        return []

    try:
        query = select(LiveSession).where(
            and_(
                LiveSession.user_id == user_id,
                LiveSession.session_type == "extension",
            )
        )
        if active_only:
            query = query.where(LiveSession.is_active == True)

        result = await db.execute(query)
        sessions = result.scalars().all()

        return [
            {
                "session_id": s.ext_session_id,
                "video_id": s.video_id,
                "user_id": s.user_id,
                "source": s.source,
                "room_id": s.room_id,
                "account": s.account,
                "region": s.region,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "active": s.is_active,
                "stream_info": s.stream_info or {},
                "latest_metrics": s.latest_metrics or {},
            }
            for s in sessions
        ]
    except Exception as e:
        _db_available = False
        logger.warning(f"DB query failed for extension sessions: {e}")
        return []


async def restore_active_sessions(db: AsyncSession) -> int:
    """
    Restore in-memory state from DB on startup.
    Called during app initialization.
    Returns the number of restored sessions.
    """
    global _db_available
    try:
        sessions = await get_active_sessions_from_db(db)
        count = 0
        for s in sessions:
            video_id = s["video_id"]
            _live_status[video_id] = True
            if s.get("stream_info"):
                _live_stream_info[video_id] = s["stream_info"]
            if s.get("latest_metrics"):
                _live_metrics[video_id] = s["latest_metrics"]
            count += 1
            logger.info(f"Restored active session: {video_id} (type={s['session_type']})")

        if count > 0:
            logger.info(f"Restored {count} active live sessions from database")
        return count
    except Exception as e:
        _db_available = False
        logger.warning(f"Failed to restore sessions from DB (table may not exist): {e}")
        return 0


# ── Public API (in-memory, synchronous for SSE performance) ──────────

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
    """Clean up all in-memory data for a video that's no longer live."""
    _live_events.pop(video_id, None)
    _live_metrics.pop(video_id, None)
    _live_stream_info.pop(video_id, None)
    _live_status.pop(video_id, None)
    _live_subscribers.pop(video_id, None)


def get_active_live_sessions() -> list:
    """Get all currently active live monitoring sessions (from in-memory)."""
    return [
        {
            "video_id": vid,
            "stream_info": _live_stream_info.get(vid, {}),
            "latest_metrics": _live_metrics.get(vid, {}),
        }
        for vid, is_active in _live_status.items()
        if is_active
    ]

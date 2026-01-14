"""
Database operations for batch worker.
Provides synchronous wrappers around async SQLAlchemy operations.
"""
import asyncio
import os, json
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
import uuid
from sqlalchemy import text
import json

# Load environment variables
load_dotenv()

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in environment")

# Create async engine
engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Global event loop for reuse (avoids asyncpg pool conflicts)
_loop = None


def get_event_loop():
    """Get or create a persistent event loop for DB operations."""
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop


@asynccontextmanager
async def get_session():
    """Async context manager for database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# async def init_db():
#     """Initialize database connection (test connectivity)."""
#     async with get_session() as session:
#         await session.execute("SELECT 1")
#     print("[DB] Database connection initialized successfully")

async def init_db():
    async with get_session() as session:
        await session.execute(text("SELECT 1"))
    print("[DB] Database connection initialized successfully")


async def close_db():
    """Close database engine and cleanup."""
    await engine.dispose()
    print("[DB] Database connection closed")


def init_db_sync():
    """Synchronous wrapper for database initialization."""
    loop = get_event_loop()
    loop.run_until_complete(init_db())


def close_db_sync():
    """Synchronous wrapper for database cleanup."""
    loop = get_event_loop()
    loop.run_until_complete(close_db())


from sqlalchemy import text


async def insert_phase(
    video_id: str,
    phase_index: int,
    phase_description: str | None,
    time_start: float | None,
    time_end: float | None,
    view_start: int | None,
    view_end: int | None,
    like_start: int | None,
    like_end: int | None,
    delta_view: int | None,
    delta_like: int | None,
    phase_group_id: int | None = None,
):
    """Insert a phase row and return the generated UUID as string."""
    sql = text(
        """
        INSERT INTO phases (
            video_id, phase_group_id, phase_index, phase_description,
            time_start, time_end, view_start, view_end,
            like_start, like_end, delta_view, delta_like
        ) VALUES (
            :video_id, :phase_group_id, :phase_index, :phase_description,
            :time_start, :time_end, :view_start, :view_end,
            :like_start, :like_end, :delta_view, :delta_like
        ) RETURNING id
        """
    )

    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {
            "video_id": video_id,
            "phase_group_id": phase_group_id,
            "phase_index": phase_index,
            "phase_description": phase_description,
            "time_start": time_start,
            "time_end": time_end,
            "view_start": view_start,
            "view_end": view_end,
            "like_start": like_start,
            "like_end": like_end,
            "delta_view": delta_view,
            "delta_like": delta_like,
        })
        row = result.fetchone()
        await session.commit()

    if row is None:
        raise RuntimeError("Failed to insert phase")

    # returned id is UUID object (if driver returns), convert to str
    return str(row[0])


def insert_phase_sync(*args, **kwargs):
    """Synchronous wrapper for `insert_phase` that returns the new id as string."""
    loop = get_event_loop()
    return loop.run_until_complete(insert_phase(*args, **kwargs))

# ---------- STEP 5: insert video_phases ----------

async def insert_video_phase(
    video_id: str,
    phase_index: int,
    phase_description: str | None,
    time_start: float | None,
    time_end: float | None,
    view_start: int | None,
    view_end: int | None,
    like_start: int | None,
    like_end: int | None,
    delta_view: int | None,
    delta_like: int | None,
):
    sql = text("""
        INSERT INTO video_phases (
            id, video_id, phase_index, group_id,
            phase_description,
            time_start, time_end,
            view_start, view_end,
            like_start, like_end,
            delta_view, delta_like
        ) VALUES (
            :id, :video_id, :phase_index, NULL,
            :phase_description,
            :time_start, :time_end,
            :view_start, :view_end,
            :like_start, :like_end,
            :delta_view, :delta_like
        )
        RETURNING id
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {
            "id": new_id,
            "video_id": video_id,
            "phase_index": phase_index,
            "phase_description": phase_description,
            "time_start": time_start,
            "time_end": time_end,
            "view_start": view_start,
            "view_end": view_end,
            "like_start": like_start,
            "like_end": like_end,
            "delta_view": delta_view,
            "delta_like": delta_like,
        })
        await session.commit()

    return new_id


def insert_video_phase_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(insert_video_phase(*args, **kwargs))


# ---------- STEP 6: update phase_description ----------

async def update_video_phase_description(
    video_id: str,
    phase_index: int,
    phase_description: str,
):
    sql = text("""
        UPDATE video_phases
        SET phase_description = :phase_description,
            updated_at = now()
        WHERE video_id = :video_id
          AND phase_index = :phase_index
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "video_id": video_id,
            "phase_index": phase_index,
            "phase_description": phase_description,
        })
        await session.commit()


def update_video_phase_description_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(update_video_phase_description(*args, **kwargs))


# ---------- STEP 7: upsert phase_groups + update video_phases ----------
async def get_all_phase_groups():
    sql = text("""
        SELECT id, centroid, size
        FROM phase_groups
        ORDER BY id ASC
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql)
        rows = result.fetchall()

    groups = []
    for r in rows:
        groups.append({
            "group_id": r.id,
            # "centroid": json.loads(r.centroid),
            "centroid": r.centroid,
            "size": r.size,
        })
    return groups


def get_all_phase_groups_sync():
    loop = get_event_loop()
    return loop.run_until_complete(get_all_phase_groups())


async def upsert_phase_group(group_id: int, centroid: list[float], size: int):
    sql = text("""
        INSERT INTO phase_groups (id, centroid, size)
        VALUES (:id, :centroid, :size)
        ON CONFLICT (id)
        DO UPDATE SET
            centroid = EXCLUDED.centroid,
            size = EXCLUDED.size,
            updated_at = now()
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": group_id,
            "centroid": json.dumps(centroid),
            "size": size,
        })
        await session.commit()


async def update_phase_group_for_video_phase(video_id: str, phase_index: int, group_id: int):
    sql = text("""
        UPDATE video_phases
        SET group_id = :group_id
        WHERE video_id = :video_id
          AND phase_index = :phase_index
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "group_id": group_id,
            "video_id": video_id,
            "phase_index": phase_index,
        })
        await session.commit()


def upsert_phase_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(upsert_phase_group(*args, **kwargs))


def update_phase_group_for_video_phase_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(update_phase_group_for_video_phase(*args, **kwargs))


async def create_phase_group(centroid: list[float], size: int):
    sql = text("""
        INSERT INTO phase_groups (centroid, size)
        VALUES (:centroid, :size)
        RETURNING id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {
            "centroid": json.dumps(centroid),
            "size": size,
        })
        row = result.fetchone()
        await session.commit()
    return row[0]


def create_phase_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(create_phase_group(*args, **kwargs))


async def update_phase_group(group_id: int, centroid: list[float], size: int):
    sql = text("""
        UPDATE phase_groups
        SET centroid = :centroid,
            size = :size,
            updated_at = now()
        WHERE id = :id
    """)
    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": group_id,
            "centroid": json.dumps(centroid),
            "size": size,
        })
        await session.commit()


def update_phase_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(update_phase_group(*args, **kwargs))

# ---------- STEP 8: upsert group_best_phases ----------

async def upsert_group_best_phase(
    group_id: int,
    video_id: str,
    phase_index: int,
    score: float | None,
    view_velocity: float | None,
    like_velocity: float | None,
    like_per_viewer: float | None,
):
    sql = text("""
        INSERT INTO group_best_phases (
            id, group_id, video_id, phase_index,
            score, view_velocity, like_velocity, like_per_viewer
        ) VALUES (
            :id, :group_id, :video_id, :phase_index,
            :score, :view_velocity, :like_velocity, :like_per_viewer
        )
        ON CONFLICT (group_id)
        DO UPDATE SET
            video_id = EXCLUDED.video_id,
            phase_index = EXCLUDED.phase_index,
            score = EXCLUDED.score,
            view_velocity = EXCLUDED.view_velocity,
            like_velocity = EXCLUDED.like_velocity,
            like_per_viewer = EXCLUDED.like_per_viewer,
            updated_at = now()
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "group_id": group_id,
            "video_id": video_id,
            "phase_index": phase_index,
            "score": score,
            "view_velocity": view_velocity,
            "like_velocity": like_velocity,
            "like_per_viewer": like_per_viewer,
        })
        await session.commit()


def upsert_group_best_phase_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(upsert_group_best_phase(*args, **kwargs))


async def get_group_best_phase(group_id: int):
    sql = text("""
        SELECT video_id, phase_index
        FROM group_best_phases
        WHERE group_id = :group_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"group_id": group_id})
        row = result.fetchone()
    if row:
        return row[0], row[1]
    return None, None


def get_group_best_phase_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(get_group_best_phase(*args, **kwargs))

# =========================
# Phase insight refresh flags
# =========================

async def mark_phase_insights_need_refresh(group_id: int, except_video_id: str, except_phase_index: int):
    """
    Mark all phase_insights of a group as needs_refresh = true,
    except the new best phase itself.
    """
    sql = text("""
        UPDATE phase_insights
        SET needs_refresh = true, updated_at = now()
        WHERE group_id = :group_id
          AND NOT (
            video_id = :video_id
            AND phase_index = :phase_index
          )
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "group_id": group_id,
            "video_id": except_video_id,
            "phase_index": except_phase_index,
        })
        await session.commit()


def mark_phase_insights_need_refresh_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(mark_phase_insights_need_refresh(*args, **kwargs))


async def clear_phase_insight_need_refresh(video_id: str, phase_index: int):
    """
    Set needs_refresh = false for a specific phase insight
    (typically the new best phase).
    """
    sql = text("""
        UPDATE phase_insights
        SET needs_refresh = false, updated_at = now()
        WHERE video_id = :video_id
          AND phase_index = :phase_index
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "video_id": video_id,
            "phase_index": phase_index,
        })
        await session.commit()


def clear_phase_insight_need_refresh_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(clear_phase_insight_need_refresh(*args, **kwargs))


# ---------- STEP 9: upsert phase_insights ----------

async def upsert_phase_insight(
    video_id: str,
    phase_index: int,
    group_id: int | None,
    insight: str,
):
    sql = text("""
        INSERT INTO phase_insights (
            id, video_id, phase_index, group_id, insight, needs_refresh
        ) VALUES (
            :id, :video_id, :phase_index, :group_id, :insight, false
        )
        ON CONFLICT (video_id, phase_index)
        DO UPDATE SET
            group_id = EXCLUDED.group_id,
            insight = EXCLUDED.insight,
            needs_refresh = false,
            updated_at = now()
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "video_id": video_id,
            "phase_index": phase_index,
            "group_id": group_id,
            "insight": insight,
        })
        await session.commit()


def upsert_phase_insight_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(upsert_phase_insight(*args, **kwargs))


# =========================
# Video Insights (Report 3)
# =========================

async def insert_video_insight(
    video_id: str,
    title: str,
    content: str,
):
    sql = text("""
        INSERT INTO video_insights (
            id, video_id, title, content
        ) VALUES (
            :id, :video_id, :title, :content
        )
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "video_id": video_id,
            "title": title,
            "content": content,
        })
        await session.commit()

    return new_id


def insert_video_insight_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(insert_video_insight(*args, **kwargs))




# ---------- update video status processing ----------
async def update_video_status(video_id: str, status: str):
    sql = text("""
        UPDATE videos
        SET status = :status,
            updated_at = now()
        WHERE id = :video_id
    """)
    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "video_id": video_id,
            "status": status,
        })
        await session.commit()


def update_video_status_sync(video_id: str, status: str):
    loop = get_event_loop()
    return loop.run_until_complete(update_video_status(video_id, status))

async def get_video_status(video_id: str):
    sql = text("SELECT status FROM videos WHERE id = :video_id")
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"video_id": video_id})
        row = result.fetchone()
    return row[0] if row else None

def get_video_status_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_status(video_id))


# ---------- Load phase_units for resume ----------

async def load_video_phases(video_id: str):
    sql = text("""
        SELECT
            phase_index,
            phase_description,
            time_start, time_end,
            view_start, view_end,
            like_start, like_end,
            delta_view, delta_like,
            group_id
        FROM video_phases
        WHERE video_id = :video_id
        ORDER BY phase_index ASC
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"video_id": video_id})
        rows = result.fetchall()

    phases = []
    for r in rows:
        phases.append({
            "video_id": video_id,
            "phase_index": r.phase_index,
            "phase_description": r.phase_description,
            "time_start": r.time_start,
            "time_end": r.time_end,
            "view_start": r.view_start,
            "view_end": r.view_end,
            "like_start": r.like_start,
            "like_end": r.like_end,
            "delta_view": r.delta_view,
            "delta_like": r.delta_like,
            "group_id": r.group_id,
            # fields expected by later pipeline:
            "metrics": {
                "delta_view": r.delta_view,
                "delta_like": r.delta_like,
            }
        })
    return phases


def load_video_phases_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(load_video_phases(video_id))
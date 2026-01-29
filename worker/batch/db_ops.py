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
# ---------- STEP 8 BULK OPS ----------

async def bulk_upsert_group_best_phases(rows: list[dict]):
    """
    rows = [
      {
        "group_id": int,
        "video_id": str,
        "phase_index": int,
        "score": float,
        "view_velocity": float,
        "like_velocity": float,
        "like_per_viewer": float,
      },
      ...
    ]
    """

    if not rows:
        return

    sql = text("""
        INSERT INTO group_best_phases (
            id, group_id, video_id, phase_index,
            score, view_velocity, like_velocity, like_per_viewer
        )
        SELECT
            gen_random_uuid(),
            x.group_id,
            x.video_id,
            x.phase_index,
            x.score,
            x.view_velocity,
            x.like_velocity,
            x.like_per_viewer
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(
            group_id int,
            video_id uuid,
            phase_index int,
            score float8,
            view_velocity float8,
            like_velocity float8,
            like_per_viewer float8
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

    async with AsyncSessionLocal() as session:
        await session.execute(text("SET statement_timeout = '30s'"))
        await session.execute(sql, {"rows": json.dumps(rows)})
        await session.commit()


def bulk_upsert_group_best_phases_sync(rows):
    loop = get_event_loop()
    return loop.run_until_complete(bulk_upsert_group_best_phases(rows))


async def bulk_refresh_phase_insights(best_rows: list[dict]):
    """
    best_rows = same list as above
    """

    if not best_rows:
        return

    # 1) Mark all phase_insights of affected groups = true
    sql_mark = text("""
        UPDATE phase_insights pi
        SET needs_refresh = true,
            updated_at = now()
        WHERE pi.group_id IN (
            SELECT DISTINCT (x->>'group_id')::int
            FROM jsonb_array_elements(CAST(:rows AS jsonb)) x
        )
    """)

    # 2) Clear needs_refresh for the best phases themselves
    sql_clear = text("""
        UPDATE phase_insights pi
        SET needs_refresh = false,
            updated_at = now()
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(
            group_id int,
            video_id uuid,
            phase_index int,
            score float8,
            view_velocity float8,
            like_velocity float8,
            like_per_viewer float8
        )
        WHERE pi.video_id = x.video_id
          AND pi.phase_index = x.phase_index
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(text("SET statement_timeout = '30s'"))
        await session.execute(sql_mark, {"rows": json.dumps(best_rows)})
        await session.execute(sql_clear, {"rows": json.dumps(best_rows)})
        await session.commit()


def bulk_refresh_phase_insights_sync(rows):
    loop = get_event_loop()
    return loop.run_until_complete(bulk_refresh_phase_insights(rows))



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


# ---------- STEP 12: upsert phase_insights ----------

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
        # phases.append({
        #     "video_id": video_id,
        #     "phase_index": r.phase_index,
        #     "phase_description": r.phase_description,
        #     "time_start": r.time_start,
        #     "time_end": r.time_end,
        #     "view_start": r.view_start,
        #     "view_end": r.view_end,
        #     "like_start": r.like_start,
        #     "like_end": r.like_end,
        #     "delta_view": r.delta_view,
        #     "delta_like": r.delta_like,
        #     "group_id": r.group_id,
        #     # fields expected by later pipeline:
        #     "metrics": {
        #         "delta_view": r.delta_view,
        #         "delta_like": r.delta_like,
        #     }
        # })

        phases.append({
            "video_id": video_id,
            "phase_index": r.phase_index,
            "phase_description": r.phase_description,

            "time_start": r.time_start,
            "time_end": r.time_end,

            "time_range": {
                "start": r.time_start,
                "end": r.time_end,
                "start_sec": float(r.time_start) if r.time_start is not None else 0.0,
                "end_sec": float(r.time_end) if r.time_end is not None else 0.0,
            },

            "view_start": r.view_start,
            "view_end": r.view_end,
            "like_start": r.like_start,
            "like_end": r.like_end,
            "delta_view": r.delta_view,
            "delta_like": r.delta_like,
            "group_id": r.group_id,

            "metrics": {
                "delta_view": r.delta_view,
                "delta_like": r.delta_like,
            },

            "metric_timeseries": {
                "start": {
                    "view": r.view_start,
                    "like": r.like_start,
                },
                "end": {
                    "view": r.view_end,
                    "like": r.like_end,
                }
            }
        })


    return phases


def load_video_phases_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(load_video_phases(video_id))


# =========================
# STEP 9 (VIDEO STRUCTURE): upsert video_structure_features
# =========================

async def upsert_video_structure_features(
    video_id: str,
    phase_count: int,
    avg_phase_duration: float,
    switch_rate: float,
    early_ratio: dict,
    mid_ratio: dict,
    late_ratio: dict,
    structure_embedding: list,
):
    sql = text("""
        INSERT INTO video_structure_features (
            video_id,
            phase_count,
            avg_phase_duration,
            switch_rate,
            early_ratio,
            mid_ratio,
            late_ratio,
            structure_embedding
        )
        VALUES (
            :video_id,
            :phase_count,
            :avg_phase_duration,
            :switch_rate,
            :early_ratio,
            :mid_ratio,
            :late_ratio,
            :structure_embedding
        )
        ON CONFLICT (video_id)
        DO UPDATE SET
            phase_count = EXCLUDED.phase_count,
            avg_phase_duration = EXCLUDED.avg_phase_duration,
            switch_rate = EXCLUDED.switch_rate,
            early_ratio = EXCLUDED.early_ratio,
            mid_ratio = EXCLUDED.mid_ratio,
            late_ratio = EXCLUDED.late_ratio,
            structure_embedding = EXCLUDED.structure_embedding
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "video_id": video_id,
            "phase_count": phase_count,
            "avg_phase_duration": avg_phase_duration,
            "switch_rate": switch_rate,
            "early_ratio": json.dumps(early_ratio),
            "mid_ratio": json.dumps(mid_ratio),
            "late_ratio": json.dumps(late_ratio),
            "structure_embedding": json.dumps(structure_embedding),
        })
        await session.commit()



def upsert_video_structure_features_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(upsert_video_structure_features(*args, **kwargs))


# =========================
# STEP 10 (VIDEO STRUCTURE): grouping ops
# =========================

# ---------- get video_structure_features ----------

async def get_video_structure_features(video_id: str):
    sql = text("""
        SELECT
            video_id,
            phase_count,
            avg_phase_duration,
            switch_rate,
            early_ratio,
            mid_ratio,
            late_ratio,
            structure_embedding
        FROM video_structure_features
        WHERE video_id = :video_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"video_id": video_id})
        row = result.mappings().first()

    if not row:
        return None

    return dict(row)


def get_video_structure_features_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_structure_features(video_id))


# ---------- get all video_structure_groups ----------

async def get_all_video_structure_groups():
    sql = text("""
        SELECT
            id,
            structure_embedding,
            avg_phase_count,
            avg_phase_duration,
            avg_switch_rate,
            early_ratio,
            mid_ratio,
            late_ratio,
            video_count
        FROM video_structure_groups
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql)
        rows = result.mappings().all()

    return [dict(r) for r in rows]


def get_all_video_structure_groups_sync():
    loop = get_event_loop()
    return loop.run_until_complete(get_all_video_structure_groups())


# ---------- create video_structure_group ----------

async def create_video_structure_group(
    structure_embedding,
    phase_count,
    avg_phase_duration,
    avg_switch_rate,
    early_ratio,
    mid_ratio,
    late_ratio,
):
    sql = text("""
    INSERT INTO video_structure_groups (
        id,
        structure_embedding,
        avg_phase_count,
        avg_phase_duration,
        avg_switch_rate,
        early_ratio,
        mid_ratio,
        late_ratio,
        video_count
    )
    VALUES (
        :id,
        CAST(:structure_embedding AS jsonb),
        :avg_phase_count,
        :avg_phase_duration,
        :avg_switch_rate,
        CAST(:early_ratio AS jsonb),
        CAST(:mid_ratio AS jsonb),
        CAST(:late_ratio AS jsonb),
        1
    )
""")


    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "structure_embedding": json.dumps(structure_embedding),
            "avg_phase_count": float(phase_count),
            "avg_phase_duration": float(avg_phase_duration),
            "avg_switch_rate": float(avg_switch_rate),
            "early_ratio": json.dumps(early_ratio),
            "mid_ratio": json.dumps(mid_ratio),
            "late_ratio": json.dumps(late_ratio),
        })
        await session.commit()

    return new_id


def create_video_structure_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(create_video_structure_group(*args, **kwargs))


# ---------- update video_structure_group ----------

async def update_video_structure_group(
    group_id: str,
    structure_embedding,
    avg_phase_count: float,
    avg_phase_duration: float,
    avg_switch_rate: float,
    early_ratio: dict,
    mid_ratio: dict,
    late_ratio: dict,
    video_count: int,
):
    sql = text("""
        UPDATE video_structure_groups
        SET
            structure_embedding = CAST(:structure_embedding AS jsonb),
            avg_phase_count = :avg_phase_count,
            avg_phase_duration = :avg_phase_duration,
            avg_switch_rate = :avg_switch_rate,
            early_ratio = CAST(:early_ratio AS jsonb),
            mid_ratio = CAST(:mid_ratio AS jsonb),
            late_ratio = CAST(:late_ratio AS jsonb),
            video_count = :video_count,
            updated_at = now()
        WHERE id = :id
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": group_id,
            "structure_embedding": json.dumps(structure_embedding),
            "avg_phase_count": float(avg_phase_count),
            "avg_phase_duration": float(avg_phase_duration),
            "avg_switch_rate": float(avg_switch_rate),
            "early_ratio": json.dumps(early_ratio),
            "mid_ratio": json.dumps(mid_ratio),
            "late_ratio": json.dumps(late_ratio),
            "video_count": int(video_count),
        })
        await session.commit()


def update_video_structure_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(update_video_structure_group(*args, **kwargs))


# ---------- upsert video_structure_group_members ----------

async def upsert_video_structure_group_member(
    video_id: str,
    group_id: str,
    distance: float | None,
):
    sql = text("""
        INSERT INTO video_structure_group_members (
            id,
            video_id,
            group_id,
            distance
        )
        VALUES (
            :id,
            :video_id,
            :group_id,
            :distance
        )
        ON CONFLICT (video_id)
        DO UPDATE SET
            group_id = EXCLUDED.group_id,
            distance = EXCLUDED.distance
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "video_id": video_id,
            "group_id": group_id,
            "distance": distance,
        })
        await session.commit()


def upsert_video_structure_group_member_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(upsert_video_structure_group_member(*args, **kwargs))


# =========================
# STEP 11 (VIDEO STRUCTURE): recompute group stats
# =========================

# ---------- get members by group ----------

async def get_video_structure_group_members_by_group(group_id: str):
    sql = text("""
        SELECT video_id
        FROM video_structure_group_members
        WHERE group_id = :group_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"group_id": group_id})
        rows = result.mappings().all()
    return [dict(r) for r in rows]


def get_video_structure_group_members_by_group_sync(group_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_structure_group_members_by_group(group_id))


# ---------- get group id of video ----------

async def get_video_structure_group_id_of_video(video_id: str):
    sql = text("""
        SELECT group_id
        FROM video_structure_group_members
        WHERE video_id = :video_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"video_id": video_id})
        row = result.mappings().first()
    if not row:
        return None
    return row["group_id"]


def get_video_structure_group_id_of_video_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_structure_group_id_of_video(video_id))


# =========================================================
# STEP 12 – VIDEO STRUCTURE BEST (DB OPS)
# =========================================================

# ---------- get phase points for velocity ----------

async def get_video_phase_points(video_id: str):
    sql = text("""
        SELECT
            (time_start + time_end) / 2.0 AS t,
            view_end,
            like_end
        FROM video_phases
        WHERE video_id = :video_id
          AND time_start IS NOT NULL
          AND time_end IS NOT NULL
          AND time_end > time_start
        ORDER BY t ASC
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"video_id": video_id})
        rows = result.mappings().all()
    return [dict(r) for r in rows]


def get_video_phase_points_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_phase_points(video_id))


# ---------- get best video of structure group ----------

async def get_video_structure_group_best_video(group_id: str):
    sql = text("""
        SELECT
            group_id,
            video_id,
            score,
            metrics
        FROM video_structure_group_best_videos
        WHERE group_id = :group_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"group_id": group_id})
        row = result.mappings().first()

    if not row:
        return None

    return dict(row)


def get_video_structure_group_best_video_sync(group_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_structure_group_best_video(group_id))


# ---------- upsert best video ----------

async def upsert_video_structure_group_best_video(
    group_id: str,
    video_id: str,
    score: float,
    metrics: dict,
):
    sql = text("""
        INSERT INTO video_structure_group_best_videos (
            id,
            group_id,
            video_id,
            score,
            metrics
        )
        VALUES (
            :id,
            :group_id,
            :video_id,
            :score,
            CAST(:metrics AS jsonb)
        )
        ON CONFLICT (group_id)
        DO UPDATE SET
            video_id = EXCLUDED.video_id,
            score = EXCLUDED.score,
            metrics = EXCLUDED.metrics,
            updated_at = now()
    """)

    new_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "id": new_id,
            "group_id": group_id,
            "video_id": video_id,
            "score": score,
            "metrics": json.dumps(metrics),
        })
        await session.commit()


def upsert_video_structure_group_best_video_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(
        upsert_video_structure_group_best_video(*args, **kwargs)
    )


# ---------- mark video_insights need refresh (except best) ----------

async def mark_video_insights_need_refresh_by_structure_group(
    group_id: str,
    except_video_id: str,
):
    sql = text("""
        UPDATE video_insights
        SET needs_refresh = true,
            updated_at = now()
        WHERE video_id IN (
            SELECT video_id
            FROM video_structure_group_members
            WHERE group_id = :group_id
              AND video_id != :except_video_id
        )
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {
            "group_id": group_id,
            "except_video_id": except_video_id,
        })
        await session.commit()


def mark_video_insights_need_refresh_by_structure_group_sync(*args, **kwargs):
    loop = get_event_loop()
    return loop.run_until_complete(
        mark_video_insights_need_refresh_by_structure_group(*args, **kwargs)
    )


# ---------- clear need refresh flag of best video ----------

async def clear_video_insight_need_refresh(video_id: str):
    sql = text("""
        UPDATE video_insights
        SET needs_refresh = false,
            updated_at = now()
        WHERE video_id = :video_id
    """)

    async with AsyncSessionLocal() as session:
        await session.execute(sql, {"video_id": video_id})
        await session.commit()


def clear_video_insight_need_refresh_sync(video_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(clear_video_insight_need_refresh(video_id))

# ---------- get video_structure_group stats ----------

async def get_video_structure_group_stats(group_id: str):
    sql = text("""
        SELECT
            id,
            structure_embedding,
            avg_phase_count,
            avg_phase_duration,
            avg_switch_rate,
            early_ratio,
            mid_ratio,
            late_ratio,
            video_count
        FROM video_structure_groups
        WHERE id = :group_id
    """)
    async with AsyncSessionLocal() as session:
        result = await session.execute(sql, {"group_id": group_id})
        row = result.mappings().first()

    if not row:
        return None

    return dict(row)


def get_video_structure_group_stats_sync(group_id: str):
    loop = get_event_loop()
    return loop.run_until_complete(get_video_structure_group_stats(group_id))

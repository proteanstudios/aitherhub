import math
import statistics

from db_ops import (
    # data points
    get_video_phase_points_sync,

    # group & best
    get_video_structure_group_id_of_video_sync,
    get_video_structure_group_best_video_sync,
    upsert_video_structure_group_best_video_sync,

    # invalidate reports
    mark_video_insights_need_refresh_by_structure_group_sync,
    clear_video_insight_need_refresh_sync,
)


# =========================================================
# METRICS
# =========================================================

def _compute_scale(points, key):
    vals = [p[key] for p in points if p.get(key) is not None and p[key] > 0]
    if not vals:
        return 0.0
    return max(vals)


def _compute_velocity(points, key):
    slopes = []

    for i in range(len(points) - 1):
        v1 = points[i].get(key)
        v2 = points[i + 1].get(key)
        t1 = points[i].get("t")
        t2 = points[i + 1].get("t")

        if v1 is None or v2 is None:
            continue

        dt = t2 - t1
        if dt <= 1e-6:
            continue

        dv = v2 - v1
        slope = dv / dt

        # ignore negative slope (noise / OCR glitch)
        if slope >= 0:
            slopes.append(slope)

    if not slopes:
        return 0.0

    try:
        return max(0.0, statistics.median(slopes))
    except Exception:
        return 0.0


def _compute_score(view_scale, view_velocity, like_scale, like_velocity):
    """
    Final score (đã chốt với anh):

    score =
        0.40 * log(1 + view_velocity)
      + 0.25 * log(1 + view_scale)
      + 0.20 * log(1 + like_velocity)
      + 0.15 * log(1 + like_scale)
    """

    return (
        0.40 * math.log(1 + view_velocity)
      + 0.25 * math.log(1 + view_scale)
      + 0.20 * math.log(1 + like_velocity)
      + 0.15 * math.log(1 + like_scale)
    )


# =========================================================
# MAIN PIPELINE
# =========================================================

def process_best_video(video_id: str, user_id: int):
    """
    Entry point:
    - Tính metrics + score cho video
    - So với best hiện tại của structure group
    - Nếu thắng:
        - Update best
        - Mark video_insights của các video khác = needs_refresh
        - Clear needs_refresh của chính video này
    """

    # ---------- get points ----------
    points = get_video_phase_points_sync(video_id)

    if not points or len(points) < 2:
        print(f"[BEST_VIDEO] Not enough data points for video {video_id}, skip")
        return

    # ---------- compute metrics ----------
    view_scale = _compute_scale(points, "view_end")
    like_scale = _compute_scale(points, "like_end")

    view_velocity = _compute_velocity(points, "view_end")
    like_velocity = _compute_velocity(points, "like_end")

    score = _compute_score(
        view_scale=view_scale,
        view_velocity=view_velocity,
        like_scale=like_scale,
        like_velocity=like_velocity,
    )

    # ---------- find group ----------
    group_id = get_video_structure_group_id_of_video_sync(video_id, user_id)
    if not group_id:
        print(f"[BEST_VIDEO] Video {video_id} has no structure group, skip")
        return

    # ---------- get current best ----------
    best = get_video_structure_group_best_video_sync(group_id, user_id)

    is_new_best = False
    if best is None:
        is_new_best = True
    else:
        try:
            if score > float(best["score"]):
                is_new_best = True
        except Exception:
            is_new_best = True

    # ---------- update if new best ----------
    if not is_new_best:
        print(f"[BEST_VIDEO] Video {video_id} is not better than current best")
        return

    print(
        f"[BEST_VIDEO] New BEST for group {group_id}: video={video_id}, score={score:.6f}"
    )

    # upsert best
    upsert_video_structure_group_best_video_sync(
        user_id=user_id,
        group_id=group_id,
        video_id=video_id,
        score=score,
        metrics={
            "view_scale": view_scale,
            "view_velocity": view_velocity,
            "like_scale": like_scale,
            "like_velocity": like_velocity,
        },
    )

    # ---------- invalidate other video_insights ----------
    mark_video_insights_need_refresh_by_structure_group_sync(
        user_id,
        group_id=group_id,
        except_video_id=video_id,
    )

    # clear flag of this video
    clear_video_insight_need_refresh_sync(video_id)

    print(f"[BEST_VIDEO] Invalidated video_insights for group {group_id}")

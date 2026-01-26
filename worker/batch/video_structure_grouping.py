import json
import math
from db_ops import (
    get_video_structure_features_sync,
    get_all_video_structure_groups_sync,
    create_video_structure_group_sync,
    update_video_structure_group_sync,
    upsert_video_structure_group_member_sync,
)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return -1.0
    return dot / (na * nb)


def assign_video_structure_group(video_id: str):
    """
    STEP 10:
    - Load video_structure_features
    - Compare with all group centroids
    - Join best group or create new
    - Update centroid + stats
    - Upsert video_structure_group_members
    """

    feat = get_video_structure_features_sync(video_id)
    if not feat:
        print("[STEP 10] No structure feature, skip")
        return None

    emb = json.loads(feat["structure_embedding"])
    if not emb:
        print("[STEP 10] Empty embedding, skip")
        return None

    groups = get_all_video_structure_groups_sync()

    best_group = None
    best_sim = -1.0

    for g in groups:
        if not g.get("structure_embedding"):
            continue
        g_emb = json.loads(g["structure_embedding"])
        sim = _cosine(emb, g_emb)
        if sim > best_sim:
            best_sim = sim
            best_group = g

    THRESHOLD = 0.85

    # =========================
    # Case 1: create new group
    # =========================
    if best_group is None or best_sim < THRESHOLD:
        group_id = create_video_structure_group_sync(
            structure_embedding=emb,
            phase_count=feat["phase_count"],
            avg_phase_duration=feat["avg_phase_duration"],
            avg_switch_rate=feat["switch_rate"],
            early_ratio=feat["early_ratio"],
            mid_ratio=feat["mid_ratio"],
            late_ratio=feat["late_ratio"],
        )
        distance = None
        print(f"[STEP 10] Create new structure group: {group_id}")

    # =========================
    # Case 2: join existing group
    # =========================
    else:
        group_id = best_group["id"]
        distance = 1.0 - best_sim

        # update centroid + stats (incremental mean)
        n = best_group["video_count"]
        if n is None:
            n = 0

        old_emb = json.loads(best_group["structure_embedding"])

        new_emb = []
        for i in range(min(len(old_emb), len(emb))):
            new_emb.append((old_emb[i] * n + emb[i]) / (n + 1))

        new_video_count = n + 1

        # update avg stats
        new_avg_phase_count = (best_group["avg_phase_count"] * n + feat["phase_count"]) / new_video_count
        new_avg_phase_duration = (best_group["avg_phase_duration"] * n + feat["avg_phase_duration"]) / new_video_count
        new_avg_switch_rate = (best_group["avg_switch_rate"] * n + feat["switch_rate"]) / new_video_count

        # ratios: simple mean (good enough for now)
        def mean_ratio(old, new):
            out = {}
            keys = set(old.keys()) | set(new.keys())
            for k in keys:
                out[k] = (old.get(k, 0.0) * n + new.get(k, 0.0)) / new_video_count
            return out

        new_early_ratio = mean_ratio(best_group["early_ratio"], feat["early_ratio"])
        new_mid_ratio = mean_ratio(best_group["mid_ratio"], feat["mid_ratio"])
        new_late_ratio = mean_ratio(best_group["late_ratio"], feat["late_ratio"])

        update_video_structure_group_sync(
            group_id=group_id,
            structure_embedding=new_emb,
            avg_phase_count=new_avg_phase_count,
            avg_phase_duration=new_avg_phase_duration,
            avg_switch_rate=new_avg_switch_rate,
            early_ratio=new_early_ratio,
            mid_ratio=new_mid_ratio,
            late_ratio=new_late_ratio,
            video_count=new_video_count,
        )

        print(f"[STEP 10] Join structure group: {group_id} (sim={best_sim:.4f})")

    # =========================
    # Save membership
    # =========================
    upsert_video_structure_group_member_sync(
        video_id=video_id,
        group_id=group_id,
        distance=distance,
    )

    return group_id

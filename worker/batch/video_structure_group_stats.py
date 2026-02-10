import json
from db_ops import (
    get_video_structure_group_members_by_group_sync,
    get_video_structure_features_sync,
    update_video_structure_group_sync,
)


def recompute_video_structure_group_stats(group_id: str, user_id: int):
    """
    STEP 11:
    Recompute centroid & stats of a structure group from ALL its members
    """

    members = get_video_structure_group_members_by_group_sync(group_id, user_id)
    if not members:
        print(f"[STEP 11] No members in group {group_id}, skip")
        return

    feats = []
    # for m in members:
    #     feat = get_video_structure_features_sync(m["video_id"], user_id)
    #     if feat:
    #         feats.append(feat)

    for video_id in members:
        feat = get_video_structure_features_sync(str(video_id), user_id)
        if feat:
            feats.append(feat)

    if not feats:
        print(f"[STEP 11] No features for group {group_id}, skip")
        return

    n = len(feats)

    # ---------- recompute centroid ----------
    vectors = [json.loads(f["structure_embedding"]) for f in feats]
    dim = min(len(v) for v in vectors)

    centroid = []
    for i in range(dim):
        centroid.append(sum(v[i] for v in vectors) / n)

    # ---------- recompute avg stats ----------
    avg_phase_count = sum(f["phase_count"] for f in feats) / n
    avg_phase_duration = sum(f["avg_phase_duration"] for f in feats) / n
    avg_switch_rate = sum(f["switch_rate"] for f in feats) / n

    # ---------- recompute ratios ----------
    def mean_ratio(dicts):
        out = {}
        for d in dicts:
            for k, v in d.items():
                out[k] = out.get(k, 0.0) + float(v)
        for k in out:
            out[k] /= n
        return out

    early_ratio = mean_ratio([f["early_ratio"] for f in feats])
    mid_ratio = mean_ratio([f["mid_ratio"] for f in feats])
    late_ratio = mean_ratio([f["late_ratio"] for f in feats])

    update_video_structure_group_sync(
        user_id=user_id,
        group_id=group_id,
        structure_embedding=centroid,
        avg_phase_count=avg_phase_count,
        avg_phase_duration=avg_phase_duration,
        avg_switch_rate=avg_switch_rate,
        early_ratio=early_ratio,
        mid_ratio=mid_ratio,
        late_ratio=late_ratio,
        video_count=n,
    )

    print(f"[STEP 11] Recomputed stats for group {group_id}")

from db_ops import (
    load_video_phases_sync,
    upsert_video_structure_features_sync,
)


def build_video_structure_features(video_id: str, user_id: int):
    """
    STEP 9:
    - Read video_phases
    - Build structure features
    - Save into video_structure_features
    """

    phases = load_video_phases_sync(video_id, user_id)

    if not phases:
        print("[STEP 9] No phases, skip video structure features")
        return

    # sort by time
    phases = sorted(phases, key=lambda p: p["time_start"])

    durations = []
    for p in phases:
        if p.get("duration") is not None:
            d = float(p["duration"])
        else:
            d = float(p["time_end"] - p["time_start"])
        durations.append(d)

    total_time = sum(durations)
    phase_count = len(phases)
    avg_phase_duration = total_time / phase_count if phase_count > 0 else 0.0
    switch_rate = phase_count / total_time if total_time > 0 else 0.0

    # split early / mid / late
    t1 = total_time / 3
    t2 = 2 * total_time / 3

    early = {}
    mid = {}
    late = {}

    acc = 0.0

    for p, d in zip(phases, durations):
        gid = str(p["group_id"])

        start = acc
        end = acc + d
        acc = end

        def add(bucket, val):
            bucket[gid] = bucket.get(gid, 0.0) + val

        # early
        if start < t1:
            overlap = max(0.0, min(end, t1) - start)
            if overlap > 0:
                add(early, overlap)

        # mid
        if end > t1 and start < t2:
            overlap = max(0.0, min(end, t2) - max(start, t1))
            if overlap > 0:
                add(mid, overlap)

        # late
        if end > t2:
            overlap = max(0.0, end - max(start, t2))
            if overlap > 0:
                add(late, overlap)

    def normalize(d):
        s = sum(d.values())
        if s <= 0:
            return {}
        return {k: v / s for k, v in d.items()}

    early_ratio = normalize(early)
    mid_ratio = normalize(mid)
    late_ratio = normalize(late)

    # build numeric vector
    all_gids = sorted(
        set(list(early_ratio.keys()) + list(mid_ratio.keys()) + list(late_ratio.keys()))
    )

    vec = []
    vec.append(float(phase_count))
    vec.append(float(avg_phase_duration))
    vec.append(float(switch_rate))

    for gid in all_gids:
        vec.append(float(early_ratio.get(gid, 0.0)))
    for gid in all_gids:
        vec.append(float(mid_ratio.get(gid, 0.0)))
    for gid in all_gids:
        vec.append(float(late_ratio.get(gid, 0.0)))

    upsert_video_structure_features_sync(
        user_id=user_id,
        video_id=video_id,
        phase_count=phase_count,
        avg_phase_duration=avg_phase_duration,
        switch_rate=switch_rate,
        early_ratio=early_ratio,
        mid_ratio=mid_ratio,
        late_ratio=late_ratio,
        structure_embedding=vec,
    )

    print("[STEP 9] Saved video_structure_features")

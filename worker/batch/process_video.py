import os
import argparse
import requests
import json
import shutil
from dotenv import load_dotenv
from ultralytics import YOLO
import subprocess
import requests
from urllib.parse import quote

from vision_pipeline import caption_keyframes
from db_ops import init_db_sync, close_db_sync

# Load environment variables
load_dotenv()

from video_frames import extract_frames, detect_phases
from phase_pipeline import (
    extract_phase_stats,
    build_phase_units,
    build_phase_descriptions,
)
from audio_pipeline import extract_audio_chunks, transcribe_audio_chunks
from grouping_pipeline import (
    embed_phase_descriptions,
    load_global_groups,
    assign_phases_to_groups,
    save_global_groups,
)
from best_phase_pipeline import (
    load_group_best_phases,
    update_group_best_phases,
    save_group_best_phases,
)
from report_pipeline import (
    build_report_1_timeline,
    build_report_2_phase_insights_raw,
    # rewrite_report_2_phase_insights_raw,
    rewrite_report_2_with_gpt,
    build_report_3_video_insights_raw,
    rewrite_report_3_with_gpt,
    save_reports,
)

from db_ops import (
    upsert_phase_group_sync,
    upsert_group_best_phase_sync,
    mark_phase_insights_need_refresh_sync,
    clear_phase_insight_need_refresh_sync,
    get_group_best_phase_sync,

    update_phase_group_for_video_phase_sync,
    upsert_phase_insight_sync,
    insert_video_insight_sync,
    update_video_status_sync,
    get_video_status_sync,
    load_video_phases_sync,
    update_video_phase_description_sync,
    update_phase_group_sync,
    get_video_structure_group_id_of_video_sync,
    bulk_upsert_group_best_phases_sync,
    bulk_refresh_phase_insights_sync,
)

from video_structure_features import build_video_structure_features
from video_structure_grouping import assign_video_structure_group
from video_structure_group_stats import recompute_video_structure_group_stats
from best_video_pipeline import process_best_video

from video_status import VideoStatus
from split_video import split_video_into_segments

# =========================
# Artifact layout (PERSISTENT)
# =========================

ART_ROOT = "output"

def video_root(video_id: str):
    return os.path.join(ART_ROOT, video_id)

def frames_dir(video_id: str):
    return os.path.join(video_root(video_id), "frames")

def cache_dir(video_id: str):
    return os.path.join(video_root(video_id), "cache")

def step1_cache_path(video_id: str):
    return os.path.join(cache_dir(video_id), "step1_phases.json")

def audio_dir(video_id: str):
    return os.path.join(video_root(video_id), "audio")

def audio_text_dir(video_id: str):
    return os.path.join(video_root(video_id), "audio_text")

# =========================
# STEP 1 cache helpers
# =========================

def save_step1_cache(video_id, keyframes, rep_frames, total_frames):
    os.makedirs(cache_dir(video_id), exist_ok=True)
    path = step1_cache_path(video_id)
    data = {
        "keyframes": keyframes,
        "rep_frames": rep_frames,
        "total_frames": total_frames,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)

def load_step1_cache(video_id):
    path = step1_cache_path(video_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

# =========================
# Resume helpers
# =========================

STEP_ORDER = [
    VideoStatus.STEP_0_EXTRACT_FRAMES,
    VideoStatus.STEP_1_DETECT_PHASES,
    VideoStatus.STEP_2_EXTRACT_METRICS,
    VideoStatus.STEP_3_TRANSCRIBE_AUDIO,
    VideoStatus.STEP_4_IMAGE_CAPTION,
    VideoStatus.STEP_5_BUILD_PHASE_UNITS,
    VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION,
    VideoStatus.STEP_7_GROUPING,
    VideoStatus.STEP_8_UPDATE_BEST_PHASE,

    VideoStatus.STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES,
    VideoStatus.STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP,
    VideoStatus.STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS,
    VideoStatus.STEP_12_UPDATE_VIDEO_STRUCTURE_BEST,

    VideoStatus.STEP_13_BUILD_REPORTS,
]

def status_to_step_index(status: str | None):
    if not status:
        return 0
    if status == VideoStatus.DONE:
        return len(STEP_ORDER)
    if status in STEP_ORDER:
        return STEP_ORDER.index(status)
    return 0

# =========================
# Utils
# =========================

def _ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

# def _download_blob(blob_url: str, dest_path: str):
#     with requests.get(blob_url, stream=True) as r:
#         r.raise_for_status()
#         with open(dest_path, "wb") as f:
#             for chunk in r.iter_content(chunk_size=8192):
#                 if chunk:
#                     f.write(chunk)

# def _download_blob(blob_url: str, dest_path: str):
#     with requests.get(blob_url, stream=True) as r:
#         r.raise_for_status()
#         total = int(r.headers.get("content-length", 0))
#         downloaded = 0

#         with open(dest_path, "wb") as f:
#             for chunk in r.iter_content(chunk_size=4 * 1024 * 1024):  # 4MB
#                 if chunk:
#                     f.write(chunk)
#                     downloaded += len(chunk)
#                     if total:
#                         print(f"[DL] {downloaded/1024/1024:.0f}MB / {total/1024/1024:.0f}MB", end="\r")

# def _download_blob(blob_url: str, dest_path: str):
#     """
#     Download blob using AzCopy if available (fast, parallel).
#     Fallback to requests if AzCopy is not installed.
#     """

#     # Ensure dest folder exists
#     os.makedirs(os.path.dirname(dest_path), exist_ok=True)

#     # Try AzCopy first
#     try:
#         print(f"[DL] Try AzCopy download: {blob_url}")

#         cmd = [
#             "azcopy",
#             "copy",
#             blob_url,
#             dest_path,
#             "--overwrite=true"
#         ]

#         result = subprocess.run(
#             cmd,
#             stdout=subprocess.PIPE,
#             stderr=subprocess.PIPE,
#             text=True,
#             check=True
#         )

#         print("[DL] AzCopy download completed")
#         return

#     except FileNotFoundError:
#         print("[WARN] AzCopy not found. Fallback to requests.")

#     except subprocess.CalledProcessError as e:
#         print("[WARN] AzCopy failed. Fallback to requests.")
#         print(e.stdout)
#         print(e.stderr)

#     # -----------------------
#     # Fallback: requests
#     # -----------------------
#     print(f"[DL] Fallback: downloading with requests: {blob_url}")

#     with requests.get(blob_url, stream=True, timeout=60) as r:
#         r.raise_for_status()
#         total = int(r.headers.get("content-length", 0))
#         downloaded = 0

#         with open(dest_path, "wb") as f:
#             for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):  # 8MB
#                 if chunk:
#                     f.write(chunk)
#                     downloaded += len(chunk)
#                     if total:
#                         print(f"[DL] {downloaded/1024/1024:.0f}MB / {total/1024/1024:.0f}MB", end="\r")

#     print("\n[DL] Requests download completed")

def _normalize_blob_url(url: str) -> str:
    if "?" not in url:
        return quote(url, safe=":/")
    base, qs = url.split("?", 1)
    base = quote(base, safe=":/")
    return base + "?" + qs

def _download_blob(blob_url: str, dest_path: str):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    # blob_url = _normalize_blob_url(blob_url)

    try:
        print(f"[DL] AzCopy download: {blob_url}")
        subprocess.run(
            ["/usr/local/bin/azcopy", "copy", blob_url, dest_path, "--overwrite=true"],
            check=True,
            capture_output=True,
            text=True
        )
        print("[DL] AzCopy completed")
        return

    except FileNotFoundError:
        print("[WARN] AzCopy not found. Fallback to requests.")

    except subprocess.CalledProcessError as e:
        print("[WARN] AzCopy failed. Fallback to requests.")
        print("STDOUT:", e.stdout)
        print("STDERR:", e.stderr)

    # ---- fallback ----
    print("[DL] Fallback to requests.get")
    with requests.get(blob_url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                if chunk:
                    f.write(chunk)

    print("[DL] Requests download completed")


def _resolve_inputs(args) -> tuple[str, str]:
    video_id = args.video_id
    video_path = args.video_path
    blob_url = args.blob_url

    if video_path:
        if not video_id:
            video_id = os.path.splitext(os.path.basename(video_path))[0]
        return video_path, video_id

    if not video_id:
        raise RuntimeError("Must provide --video-id (Azure Batch always has this).")

    local_dir = "uploadedvideo"
    _ensure_dir(local_dir)
    local_path = os.path.join(local_dir, f"{video_id}.mp4")

    if os.path.exists(local_path):
        return local_path, video_id

    if blob_url:
        print(f"[DL] Downloading video from blob: {blob_url}")
        _download_blob(blob_url, local_path)
        return local_path, video_id

    raise FileNotFoundError("No local video and no blob_url provided.")

# =========================
# MAIN
# =========================

def main():
    parser = argparse.ArgumentParser(description="Process a livestream video")
    parser.add_argument("--video-id", dest="video_id", type=str, required=True)
    parser.add_argument("--video-path", dest="video_path", type=str)
    parser.add_argument("--blob-url", dest="blob_url", type=str)
    args = parser.parse_args()

    print("[DB] Initializing database connection...")
    init_db_sync()

    try:
        video_path, video_id = _resolve_inputs(args)

        # _ensure_dir(video_root(video_id))

        # current_status = get_video_status_sync(video_id)
        # start_step = status_to_step_index(current_status)
        # print(f"[RESUME] current_status={current_status}, start_step={start_step}")

        current_status = get_video_status_sync(video_id)
        raw_start_step = status_to_step_index(current_status)

        # Chỉ cho resume nếu >= STEP 7
        if raw_start_step >= 7:
            start_step = raw_start_step

            keyframes = None
            rep_frames = None
            total_frames = None
            phase_stats = None
            keyframe_captions = None

            print(f"[RESUME] resume from step {start_step} (status={current_status})")
        else:
            start_step = 0
            print(f"[RESUME] force restart from STEP 0 (status={current_status})")

            if os.path.exists(ART_ROOT):
                print("[CLEAN] Remove old artifact folder")
                # shutil.rmtree(video_root(video_id), ignore_errors=True)
                shutil.rmtree(ART_ROOT, ignore_errors=True)
                os.makedirs(ART_ROOT, exist_ok=True)

        # =========================
        # STEP 0 – EXTRACT FRAMES
        # =========================
        frame_dir = frames_dir(video_id)

        if start_step <= 0:
            update_video_status_sync(video_id, VideoStatus.STEP_0_EXTRACT_FRAMES)
            print("=== STEP 0 – EXTRACT FRAMES ===")
            # if not os.path.exists(frame_dir) or not os.listdir(frame_dir):
            extract_frames(
                video_path=video_path,
                fps=1,
                frames_root=video_root(video_id),
            )
        else:
            print("[SKIP] STEP 0")

        # =========================
        # STEP 1 – PHASE DETECTION (YOLO + CACHE)
        # =========================
        # if start_step <= 1:
        #     update_video_status_sync(video_id, VideoStatus.STEP_1_DETECT_PHASES)

        #     cache = load_step1_cache(video_id)
        #     if cache:
        #         print("[CACHE] Load STEP 1 cache")
        #         keyframes = cache["keyframes"]
        #         rep_frames = cache["rep_frames"]
        #         total_frames = cache["total_frames"]
        #     else:
        #         print("=== STEP 1 – PHASE DETECTION (YOLO) ===")
        #         model = YOLO("yolov8n.pt", verbose=False)
        #         keyframes, rep_frames, total_frames = detect_phases(
        #             frame_dir=frame_dir,
        #             model=model,
        #         )
        #         save_step1_cache(video_id, keyframes, rep_frames, total_frames)
        # else:
        #     # print("[SKIP] STEP 1")
        #     # cache = load_step1_cache(video_id)
        #     # if not cache:
        #     #     raise RuntimeError("Missing STEP 1 cache while resuming")
        #     # keyframes = cache["keyframes"]
        #     # rep_frames = cache["rep_frames"]
        #     # total_frames = cache["total_frames"]

        #     print("[SKIP] STEP 1")
        #     if start_step < 7:
        #         cache = load_step1_cache(video_id)
        #         if not cache:
        #             raise RuntimeError("Missing STEP 1 cache while resuming")
        #         keyframes = cache["keyframes"]
        #         rep_frames = cache["rep_frames"]
        #         total_frames = cache["total_frames"]
        #     else:
        #         # Resume >= 7: không cần mấy thứ này nữa
        #         keyframes = None
        #         rep_frames = None
        #         total_frames = None

        # =========================
        # STEP 1 – PHASE DETECTION (YOLO)
        # =========================
        if start_step <= 1:
            update_video_status_sync(video_id, VideoStatus.STEP_1_DETECT_PHASES)

            print("=== STEP 1 – PHASE DETECTION (YOLO) ===")
            model = YOLO("yolov8n.pt", verbose=False)
            keyframes, rep_frames, total_frames = detect_phases(
                frame_dir=frame_dir,
                model=model,
            )
        else:
            print("[SKIP] STEP 1")
            # Resume >= 7: không cần mấy thứ này nữa
            keyframes = None
            rep_frames = None
            total_frames = None


        # =========================
        # STEP 2 – PHASE METRICS
        # =========================
        if start_step <= 2:
            update_video_status_sync(video_id, VideoStatus.STEP_2_EXTRACT_METRICS)
            print("=== STEP 2 – PHASE METRICS ===")
            phase_stats = extract_phase_stats(
                keyframes=keyframes,
                total_frames=total_frames,
                frame_dir=frame_dir,
            )
        else:
            # print("[SKIP] STEP 2 – but recompute phase_stats")
            # phase_stats = extract_phase_stats(
            #     keyframes=keyframes,
            #     total_frames=total_frames,
            #     frame_dir=frame_dir,
            # )

            print("[SKIP] STEP 2")
            phase_stats = None

        # =========================
        # STEP 3 – AUDIO → TEXT
        # =========================
        ad = audio_dir(video_id)
        atd = audio_text_dir(video_id)

        if start_step <= 3:
            update_video_status_sync(video_id, VideoStatus.STEP_3_TRANSCRIBE_AUDIO)
            print("=== STEP 3 – AUDIO TO TEXT ===")
            # if not os.path.exists(ad) or not os.listdir(ad) or not os.path.exists(atd) or not os.listdir(atd):
                # extract_audio_chunks(video_path, out_dir=ad)
                # transcribe_audio_chunks(ad)

            extract_audio_chunks(video_path, ad)
            transcribe_audio_chunks(ad, atd)
        else:
            print("[SKIP] STEP 3")

        # =========================
        # STEP 4 – IMAGE CAPTION
        # =========================
        if start_step <= 4:
            update_video_status_sync(video_id, VideoStatus.STEP_4_IMAGE_CAPTION)
            print("=== STEP 4 – IMAGE CAPTION ===")
            keyframe_captions = caption_keyframes(
                frame_dir=frame_dir,
                rep_frames=rep_frames,
            )

            # print("[CLEANUP] Remove frames")
            # shutil.rmtree(frames_dir(video_id), ignore_errors=True)
        else:
            # print("[SKIP] STEP 4")
            # keyframe_captions = caption_keyframes(
            #     frame_dir=frame_dir,
            #     rep_frames=rep_frames,
            # )
            print("[SKIP] STEP 4")
            keyframe_captions = None

        # =========================
        # STEP 5 – BUILD PHASE UNITS (DB CHECKPOINT)
        # =========================
        if start_step <= 5:
            update_video_status_sync(video_id, VideoStatus.STEP_5_BUILD_PHASE_UNITS)
            print("=== STEP 5 – BUILD PHASE UNITS ===")
            phase_units = build_phase_units(
                keyframes=keyframes,
                rep_frames=rep_frames,
                keyframe_captions=keyframe_captions,
                phase_stats=phase_stats,
                total_frames=total_frames,
                frame_dir=frame_dir,
                audio_text_dir=atd,
                video_id=video_id,
            )

            print("[CLEANUP] Remove step1 cache + audio artifacts")

            print("[CLEANUP] Remove frames")
            # shutil.rmtree(frames_dir(video_id), ignore_errors=True)
            # shutil.rmtree(cache_dir(video_id), ignore_errors=True)
            # shutil.rmtree(audio_text_dir(video_id), ignore_errors=True)
            # shutil.rmtree(audio_dir(video_id), ignore_errors=True)
        else:
            print("[SKIP] STEP 5")
            # raise RuntimeError("Resume from STEP >=5 should load phase_units from DB (not implemented yet).")
            phase_units = load_video_phases_sync(video_id)

        # =========================
        # STEP 6 – PHASE DESCRIPTION
        # =========================
        # if start_step <= 6:
        #     update_video_status_sync(video_id, VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION)
        #     print("=== STEP 6 – PHASE DESCRIPTION ===")
        #     phase_units = build_phase_descriptions(phase_units)



        if start_step <= 6:
            update_video_status_sync(video_id, VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION)
            print("=== STEP 6 – PHASE DESCRIPTION ===")
            phase_units = build_phase_descriptions(phase_units)

            print("[DB] Persist phase_description to video_phases")
            for p in phase_units:
                if p.get("phase_description"):
                    update_video_phase_description_sync(
                        video_id=video_id,
                        phase_index=p["phase_index"],
                        phase_description=p["phase_description"],
            )
        else:
            print("[SKIP] STEP 6")

        # =========================
        # STEP 7 – GLOBAL GROUPING
        # =========================
        if start_step <= 7:
            update_video_status_sync(video_id, VideoStatus.STEP_7_GROUPING)
            print("=== STEP 7 – GLOBAL PHASE GROUPING ===")
            phase_units = embed_phase_descriptions(phase_units)

            # groups = load_global_groups()
            # phase_units, groups = assign_phases_to_groups(phase_units, groups)
            # save_global_groups(groups)

            # groups = load_global_groups(ART_ROOT, video_id)
            # phase_units, groups = assign_phases_to_groups(phase_units, groups)
            # save_global_groups(groups, ART_ROOT, video_id)

            from grouping_pipeline import load_global_groups_from_db
            groups = load_global_groups_from_db()
            phase_units, groups = assign_phases_to_groups(phase_units, groups)

            # for g in groups:
            #     upsert_phase_group_sync(
            #         group_id=g["group_id"],
            #         centroid=g["centroid"].tolist(),
            #         size=g["size"],
            #     )

            for g in groups:
                update_phase_group_sync(
                    group_id=g["group_id"],
                    centroid=g["centroid"].tolist(),
                    size=g["size"],
            )

            for p in phase_units:
                if p.get("group_id"):
                    update_phase_group_for_video_phase_sync(
                        video_id=video_id,
                        phase_index=p["phase_index"],
                        group_id=p["group_id"],
                    )
        else:
            print("[SKIP] STEP 7")

        # =========================
        # STEP 8 – GROUP BEST PHASES
        # =========================
        # if start_step <= 8:
        #     update_video_status_sync(video_id, VideoStatus.STEP_8_UPDATE_BEST_PHASE)
        #     print("=== STEP 8 – GROUP BEST PHASES ===")

        #     # best_data = load_group_best_phases()
        #     # best_data = update_group_best_phases(
        #     #     phase_units=phase_units,
        #     #     best_data=best_data,
        #     #     video_id=video_id,
        #     # )
        #     # save_group_best_phases(best_data)

        #     best_data = load_group_best_phases(ART_ROOT, video_id)

        #     best_data = update_group_best_phases(
        #         phase_units=phase_units,
        #         best_data=best_data,
        #         video_id=video_id,
        #     )

        #     save_group_best_phases(best_data, ART_ROOT, video_id)

        #     for gid, g in best_data["groups"].items():
        #         if not g["phases"]:
        #             continue

        #         gid = int(gid)
        #         best = g["phases"][0]
        #         m = best["metrics"]

        #         new_best_video_id = best["video_id"]
        #         new_best_phase_index = best["phase_index"]

        #         old_video_id, old_phase_index = get_group_best_phase_sync(gid)

        #         upsert_group_best_phase_sync(
        #             group_id=gid,
        #             video_id=new_best_video_id,
        #             phase_index=new_best_phase_index,
        #             score=best["score"],
        #             view_velocity=m.get("view_velocity"),
        #             like_velocity=m.get("like_velocity"),
        #             like_per_viewer=m.get("like_per_viewer"),
        #         )

        #         if (old_video_id, old_phase_index) != (new_best_video_id, new_best_phase_index):
        #             print(f"[INFO] Best phase changed for group {gid}: marking insights dirty")

        #             mark_phase_insights_need_refresh_sync(
        #                 group_id=gid,
        #                 except_video_id=new_best_video_id,
        #                 except_phase_index=new_best_phase_index,
        #             )

        #             clear_phase_insight_need_refresh_sync(
        #                 video_id=new_best_video_id,
        #                 phase_index=new_best_phase_index,
        #             )
        # else:
        #     print("[SKIP] STEP 8")

        if start_step <= 8:
            update_video_status_sync(video_id, VideoStatus.STEP_8_UPDATE_BEST_PHASE)
            print("=== STEP 8 – GROUP BEST PHASES (BULK) ===")

            best_data = load_group_best_phases(ART_ROOT, video_id)

            best_data = update_group_best_phases(
                phase_units=phase_units,
                best_data=best_data,
                video_id=video_id,
            )

            save_group_best_phases(best_data, ART_ROOT, video_id)

            # --------- Build bulk rows ---------
            bulk_rows = []

            for gid, g in best_data["groups"].items():
                if not g["phases"]:
                    continue

                gid = int(gid)
                best = g["phases"][0]
                m = best["metrics"]

                bulk_rows.append({
                    "group_id": gid,
                    "video_id": best["video_id"],
                    "phase_index": best["phase_index"],
                    "score": best["score"],
                    "view_velocity": m.get("view_velocity"),
                    "like_velocity": m.get("like_velocity"),
                    "like_per_viewer": m.get("like_per_viewer"),
                })

            print(f"[STEP8] Bulk upsert {len(bulk_rows)} group best phases")

            bulk_upsert_group_best_phases_sync(bulk_rows)
            bulk_refresh_phase_insights_sync(bulk_rows)

        else:
            print("[SKIP] STEP 8")

       
        # =========================
        # STEP 9 – BUILD VIDEO STRUCTURE FEATURES
        # =========================
        if start_step <= 9:
            update_video_status_sync(video_id, VideoStatus.STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES)
            print("=== STEP 9 – BUILD VIDEO STRUCTURE FEATURES ===")
            build_video_structure_features(video_id)
        else:
            print("[SKIP] STEP 9")


        # =========================
        # STEP 10 – ASSIGN VIDEO STRUCTURE GROUP
        # =========================
        if start_step <= 10:
            update_video_status_sync(video_id, VideoStatus.STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP)
            print("=== STEP 10 – ASSIGN VIDEO STRUCTURE GROUP ===")

            assign_video_structure_group(video_id)
        else:
            print("[SKIP] STEP 10")


        # =========================
        # STEP 11 – UPDATE VIDEO STRUCTURE GROUP STATS
        # =========================
        if start_step <= 11:
            update_video_status_sync(video_id, VideoStatus.STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS)
            print("=== STEP 11 – UPDATE VIDEO STRUCTURE GROUP STATS ===")

            group_id = get_video_structure_group_id_of_video_sync(video_id)
            if group_id:
                recompute_video_structure_group_stats(group_id)
        else:
            print("[SKIP] STEP 11")

        # =========================
        # STEP 12 – UPDATE VIDEO STRUCTURE BEST
        # =========================
        if start_step <= 12:
            update_video_status_sync(video_id, VideoStatus.STEP_12_UPDATE_VIDEO_STRUCTURE_BEST)
            print("=== STEP 12 – UPDATE VIDEO STRUCTURE BEST ===")

            
            process_best_video(video_id)
        else:
            print("[SKIP] STEP 12")


        # ---------- ensure best_data for resume ----------
        # ---------- ensure best_data for resume ----------
        if 'best_data' not in locals() or best_data is None:
            print("[RESUME] Reload best_data from artifact")
            best_data = load_group_best_phases(ART_ROOT, video_id)

        # =========================
        # STEP 13 – BUILD REPORTS
        # =========================
        if start_step <= 13:
            update_video_status_sync(video_id, VideoStatus.STEP_13_BUILD_REPORTS)
            print("=== STEP 13 – BUILD REPORTS ===")

            # ---------- REPORT 1 ----------
            r1 = build_report_1_timeline(phase_units)

            # ---------- REPORT 2 (PHASE INSIGHTS) ----------
            r2_raw = build_report_2_phase_insights_raw(phase_units, best_data)
            r2_gpt = rewrite_report_2_with_gpt(r2_raw)

            for item in r2_gpt:
                upsert_phase_insight_sync(
                    video_id=video_id,
                    phase_index=item["phase_index"],
                    group_id=int(item["group_id"]) if item.get("group_id") else None,
                    insight=item["insight"],
                )

            # ---------- REPORT 3 (VIDEO STRUCTURE vs BENCHMARK) ----------
            from report_pipeline import (
                build_report_3_structure_vs_benchmark_raw,
                rewrite_report_3_structure_with_gpt,
            )
            from db_ops import (
                get_video_structure_features_sync,
                get_video_structure_group_best_video_sync,
                get_video_structure_group_stats_sync,
            )

            group_id = get_video_structure_group_id_of_video_sync(video_id)
            if not group_id:
                print("[REPORT3] No structure group, skip")
            else:
                best = get_video_structure_group_best_video_sync(group_id)
                if not best:
                    print("[REPORT3] No benchmark video, skip")
                else:
                    best_video_id = best["video_id"]

                    current_features = get_video_structure_features_sync(video_id)
                    best_features = get_video_structure_features_sync(best_video_id)
                    group_stats = get_video_structure_group_stats_sync(group_id)

                    if not current_features or not best_features:
                        print("[REPORT3] Missing structure features, skip")
                    else:
                        r3_raw = build_report_3_structure_vs_benchmark_raw(
                            current_features=current_features,
                            best_features=best_features,
                            group_stats=group_stats,
                        )

                        r3_gpt = rewrite_report_3_structure_with_gpt(r3_raw)

                        # Save debug artifacts (optional)
                        save_reports(
                            video_id,
                            r1,
                            r2_raw,
                            r2_gpt,
                            r3_raw,
                            r3_gpt,
                        )

                        insert_video_insight_sync(
                            video_id=video_id,
                            title="Video Structure Analysis",
                            content=json.dumps(r3_gpt, ensure_ascii=False),
                        )

        else:
            print("[SKIP] STEP 13")

        # update_video_status_sync(video_id, VideoStatus.DONE)
        # print("\n[SUCCESS] Video processing completed successfully")


        # =========================
        # STEP 14 – Split the video into segments based on the report
        # =========================
        if start_step <= 14:
            update_video_status_sync(video_id, VideoStatus.STEP_14_SPLIT_VIDEO)
            print("=== STEP 14 – SPLIT VIDEO INTO SEGMENTS ===")
            try:
                url = args.blob_url if getattr(args, "blob_url", None) else video_path
                split_video_into_segments(video_id, url, video_path)
            except Exception as e:
                print(f"[WARN] split_video failed: {e}")

            update_video_status_sync(video_id, VideoStatus.DONE)
            print("\n[SUCCESS] Video processing completed successfully")
        

        # =========================
        # CLEANUP – CLEAR uploadedvideo
        # =========================
        try:
            upload_dir = "uploadedvideo"
            if os.path.exists(upload_dir):
                print(f"[CLEANUP] Clear all files in {upload_dir}/")

                for name in os.listdir(upload_dir):
                    path = os.path.join(upload_dir, name)
                    try:
                        if os.path.isfile(path) or os.path.islink(path):
                            os.remove(path)
                        elif os.path.isdir(path):
                            shutil.rmtree(path)
                    except Exception as e:
                        print(f"[WARN] Could not remove {path}: {e}")
        except Exception as e:
            print(f"[WARN] Cleanup uploadedvideo failed: {e}")



    except Exception as e:
        update_video_status_sync(video_id, VideoStatus.ERROR)
        print(f"\n[ERROR] Video processing failed: {e}")
        raise
    finally:
        print("[DB] Closing database connection...")
        close_db_sync()

if __name__ == "__main__":
    main()

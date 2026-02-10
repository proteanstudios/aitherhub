import os, time, sys
import argparse
import json
import shutil
import logging

from dotenv import load_dotenv
from ultralytics import YOLO
import subprocess
import requests

from vision_pipeline import caption_keyframes
from db_ops import init_db_sync, close_db_sync


LOG_DIR = "logs"
# DOWNLOAD_LOG = os.path.join(LOG_DIR, "download.log")

os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "process_video.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),  # vẫn ra console
    ],
)
logger = logging.getLogger("process_video")

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
    assign_phases_to_groups,
)
from best_phase_pipeline import (
    load_group_best_phases,
    update_group_best_phases,
    save_group_best_phases,
)
from report_pipeline import (
    build_report_1_timeline,
    build_report_2_phase_insights_raw,
    rewrite_report_2_with_gpt,
    save_reports,
)

from db_ops import (
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
    get_video_split_status_sync,
    get_user_id_of_video_sync
)

from video_structure_features import build_video_structure_features
from video_structure_grouping import assign_video_structure_group
from video_structure_group_stats import recompute_video_structure_group_stats
from best_video_pipeline import process_best_video

from video_status import VideoStatus


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
    VideoStatus.STEP_14_FINALIZE
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


def _download_blob(blob_url: str, dest_path: str):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    logger.info(f"START download")
    logger.info(f"URL = {blob_url}")
    logger.info(f"DEST = {dest_path}")

    try:
        logger.info("Try AzCopy...")

        result = subprocess.run(
            ["/usr/local/bin/azcopy", "copy", blob_url, dest_path, "--overwrite=true"],
            check=True,
            capture_output=True,
            text=True
        )

        logger.info("AzCopy SUCCESS")
        logger.info("AzCopy STDOUT:")
        logger.info(result.stdout or "<empty>")
        logger.info("AzCopy STDERR:")
        logger.info(result.stderr or "<empty>")

        return

    except FileNotFoundError as e:
        logger.info("AzCopy NOT FOUND")
        logger.info(f"Exception: {repr(e)}")

    except subprocess.CalledProcessError as e:
        # logger.info("AzCopy FAILED")
        logger.warning("AzCopy FAILED")
        logger.info("AzCopy STDOUT:")
        logger.info(e.stdout or "<empty>")
        logger.info("AzCopy STDERR:")
        logger.info(e.stderr or "<empty>")
        logger.info(f"Return code: {e.returncode}")

    except Exception as e:
        logger.info("AzCopy UNKNOWN ERROR")
        logger.info(f"Exception: {repr(e)}")

    # ---- fallback ----
    logger.info("Fallback to requests.get")

    try:
        with requests.get(blob_url, stream=True, timeout=60) as r:
            r.raise_for_status()

            total = int(r.headers.get("content-length", 0))
            downloaded = 0

            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

            logger.info(f"Requests SUCCESS: downloaded {downloaded} bytes (total={total})")

    except Exception as e:
        logger.info("Requests FAILED")
        logger.info(f"Exception: {repr(e)}")
        raise

    logger.info("END download")



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
        logger.info(f"[DL] Downloading video from blob: {blob_url}")
        _download_blob(blob_url, local_path)
        return local_path, video_id

    raise FileNotFoundError("No local video and no blob_url provided.")


def fire_split_async(args, video_id, video_path, phase_source):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    split_script = os.path.join(script_dir, "split_video_async.py")

    logger.info("[ASYNC] Fire split_video")
    logger.info("[ASYNC] python = %s", sys.executable)
    logger.info("[ASYNC] script = %s", split_script)
    logger.info("[ASYNC] video_id = %s | source = %s", video_id, phase_source)

    # os.makedirs("logs", exist_ok=True)
    # err_log = open("logs/split_spawn.log", "ab")

    url = args.blob_url if getattr(args, "blob_url", None) else video_path

     # ===== debug =====
    # if video_id == "5ab59f1d-6589-4fc7-79b7-796ba56a2439":
    #     url = (
    #         "https://kyogokuvideos.blob.core.windows.net/"
    #         "videos/"
    #         "abc@gmail.com/"
    #         "5ab59f1d-6589-4fc7-79b7-796ba56a2439/"
    #         "source.mp4"
    #     )
    #     logger.warning("[TEMP] Force blob_url = %s", url)
    # # ===== END TEMP =====


    subprocess.Popen(
        [
            sys.executable,
            split_script,
            "--video-id", video_id,
            "--video-path", video_path,
            "--phase-source", phase_source,
            "--blob-url", url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )


# =========================
# MAIN
# =========================

def main():
    parser = argparse.ArgumentParser(description="Process a livestream video")
    parser.add_argument("--video-id", dest="video_id", type=str, required=True)
    parser.add_argument("--video-path", dest="video_path", type=str)
    parser.add_argument("--blob-url", dest="blob_url", type=str)
    args = parser.parse_args()

    logger.info("[DB] Initializing database connection...")
    init_db_sync()

    try:
        video_path, video_id = _resolve_inputs(args)
        current_status = get_video_status_sync(video_id)
        raw_start_step = status_to_step_index(current_status)

        user_id = get_user_id_of_video_sync(video_id)
        if user_id is None:
            logger.error(
                "[FATAL] Cannot resolve user_id for video_id=%s (video not found or missing owner)", video_id,
            )
            raise RuntimeError(f"Cannot resolve user_id for video {video_id}")

        # Chỉ cho resume nếu >= STEP 7
        if raw_start_step >= 7:
            start_step = raw_start_step

            keyframes = None
            rep_frames = None
            total_frames = None
            phase_stats = None
            keyframe_captions = None

            logger.info(f"[RESUME] resume from step {start_step} (status={current_status})")

            fire_split_async(args, video_id, video_path, "db")

        else:
            start_step = 0
            logger.info(f"[RESUME] force restart from STEP 0 (status={current_status})")

            if os.path.exists(ART_ROOT):
                logger.info("[CLEAN] Remove old artifact folder")
                # shutil.rmtree(video_root(video_id), ignore_errors=True)
                shutil.rmtree(ART_ROOT, ignore_errors=True)
                os.makedirs(ART_ROOT, exist_ok=True)

        # =========================
        # STEP 0 – EXTRACT FRAMES
        # =========================
        frame_dir = frames_dir(video_id)

        if start_step <= 0:
            update_video_status_sync(video_id, VideoStatus.STEP_0_EXTRACT_FRAMES)
            logger.info("=== STEP 0 – EXTRACT FRAMES ===")
            # if not os.path.exists(frame_dir) or not os.listdir(frame_dir):
            extract_frames(
                video_path=video_path,
                fps=1,
                frames_root=video_root(video_id),
            )
        else:
            logger.info("[SKIP] STEP 0")

        # =========================
        # STEP 1 – PHASE DETECTION (YOLO)
        # =========================
        if start_step <= 1:
            update_video_status_sync(video_id, VideoStatus.STEP_1_DETECT_PHASES)

            logger.info("=== STEP 1 – PHASE DETECTION (YOLO) ===")
            model = YOLO("yolov8n.pt", verbose=False)
            keyframes, rep_frames, total_frames = detect_phases(
                frame_dir=frame_dir,
                model=model,
            )

            save_step1_cache(
                video_id=video_id,
                keyframes=keyframes,
                rep_frames=rep_frames,
                total_frames=total_frames,
            )

            fire_split_async(args, video_id, video_path, "step1")

        else:
            logger.info("[SKIP] STEP 1")
            keyframes = None
            rep_frames = None
            total_frames = None


        # =========================
        # STEP 2 – PHASE METRICS
        # =========================
        if start_step <= 2:
            update_video_status_sync(video_id, VideoStatus.STEP_2_EXTRACT_METRICS)
            logger.info("=== STEP 2 – PHASE METRICS ===")
            phase_stats = extract_phase_stats(
                keyframes=keyframes,
                total_frames=total_frames,
                frame_dir=frame_dir,
            )
        else:
            logger.info("[SKIP] STEP 2")
            phase_stats = None

        # =========================
        # STEP 3 – AUDIO → TEXT
        # =========================
        ad = audio_dir(video_id)
        atd = audio_text_dir(video_id)

        if start_step <= 3:
            update_video_status_sync(video_id, VideoStatus.STEP_3_TRANSCRIBE_AUDIO)
            logger.info("=== STEP 3 – AUDIO TO TEXT ===")
            extract_audio_chunks(video_path, ad)
            transcribe_audio_chunks(ad, atd)
        else:
            logger.info("[SKIP] STEP 3")

        # =========================
        # STEP 4 – IMAGE CAPTION
        # =========================
        if start_step <= 4:
            update_video_status_sync(video_id, VideoStatus.STEP_4_IMAGE_CAPTION)
            logger.info("=== STEP 4 – IMAGE CAPTION ===")
            keyframe_captions = caption_keyframes(
                frame_dir=frame_dir,
                rep_frames=rep_frames,
            )

        else:
            logger.info("[SKIP] STEP 4")
            keyframe_captions = None

        # =========================
        # STEP 5 – BUILD PHASE UNITS (DB CHECKPOINT)
        # =========================
        if start_step <= 5:
            update_video_status_sync(video_id, VideoStatus.STEP_5_BUILD_PHASE_UNITS)
            logger.info("=== STEP 5 – BUILD PHASE UNITS ===")
            phase_units = build_phase_units(
                user_id,
                keyframes=keyframes,
                rep_frames=rep_frames,
                keyframe_captions=keyframe_captions,
                phase_stats=phase_stats,
                total_frames=total_frames,
                frame_dir=frame_dir,
                audio_text_dir=atd,
                video_id=video_id,
            )

            logger.info("[CLEANUP] Remove step1 cache + audio artifacts")
            logger.info("[CLEANUP] Remove frames")

        else:
            logger.info("[SKIP] STEP 5")
            # raise RuntimeError("Resume from STEP >=5 should load phase_units from DB (not implemented yet).")
            phase_units = load_video_phases_sync(video_id, user_id)

        # =========================
        # STEP 6 – PHASE DESCRIPTION
        # =========================

        if start_step <= 6:
            update_video_status_sync(video_id, VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION)
            logger.info("=== STEP 6 – PHASE DESCRIPTION ===")
            phase_units = build_phase_descriptions(phase_units)

            logger.info("[DB] Persist phase_description to video_phases")
            for p in phase_units:
                if p.get("phase_description"):
                    update_video_phase_description_sync(
                        video_id=video_id,
                        phase_index=p["phase_index"],
                        phase_description=p["phase_description"],
            )
        else:
            logger.info("[SKIP] STEP 6")

        # =========================
        # STEP 7 – GLOBAL GROUPING
        # =========================
        if start_step <= 7:
            update_video_status_sync(video_id, VideoStatus.STEP_7_GROUPING)
            logger.info("=== STEP 7 – GLOBAL PHASE GROUPING ===")
            phase_units = embed_phase_descriptions(phase_units)

            from grouping_pipeline import load_global_groups_from_db
            groups = load_global_groups_from_db(user_id)
            phase_units, groups = assign_phases_to_groups(phase_units, groups, user_id)

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
            logger.info("[SKIP] STEP 7")

        # =========================
        # STEP 8 – GROUP BEST PHASES
        # =========================
       
        if start_step <= 8:
            update_video_status_sync(video_id, VideoStatus.STEP_8_UPDATE_BEST_PHASE)
            logger.info("=== STEP 8 – GROUP BEST PHASES (BULK) ===")

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

            logger.info(f"[STEP8] Bulk upsert {len(bulk_rows)} group best phases")


            bulk_upsert_group_best_phases_sync(user_id,bulk_rows)
            bulk_refresh_phase_insights_sync( user_id,bulk_rows)

        else:
            logger.info("[SKIP] STEP 8")

       
        # =========================
        # STEP 9 – BUILD VIDEO STRUCTURE FEATURES
        # =========================
        if start_step <= 9:
            update_video_status_sync(video_id, VideoStatus.STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES)
            logger.info("=== STEP 9 – BUILD VIDEO STRUCTURE FEATURES ===")
            build_video_structure_features(video_id, user_id)
        else:
            logger.info("[SKIP] STEP 9")


        # =========================
        # STEP 10 – ASSIGN VIDEO STRUCTURE GROUP
        # =========================
        if start_step <= 10:
            update_video_status_sync(video_id, VideoStatus.STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP)
            logger.info("=== STEP 10 – ASSIGN VIDEO STRUCTURE GROUP ===")

            assign_video_structure_group(video_id, user_id)
        else:
            logger.info("[SKIP] STEP 10")


        # =========================
        # STEP 11 – UPDATE VIDEO STRUCTURE GROUP STATS
        # =========================
        if start_step <= 11:
            update_video_status_sync(video_id, VideoStatus.STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS)
            logger.info("=== STEP 11 – UPDATE VIDEO STRUCTURE GROUP STATS ===")

            group_id = get_video_structure_group_id_of_video_sync(video_id, user_id)
            if group_id:
                recompute_video_structure_group_stats(group_id, user_id)
        else:
            logger.info("[SKIP] STEP 11")

        # =========================
        # STEP 12 – UPDATE VIDEO STRUCTURE BEST
        # =========================
        if start_step <= 12:
            update_video_status_sync(video_id, VideoStatus.STEP_12_UPDATE_VIDEO_STRUCTURE_BEST)
            logger.info("=== STEP 12 – UPDATE VIDEO STRUCTURE BEST ===")

            
            process_best_video(video_id, user_id)
        else:
            logger.info("[SKIP] STEP 12")


        # ---------- ensure best_data for resume ----------
        # ---------- ensure best_data for resume ----------
        if 'best_data' not in locals() or best_data is None:
            logger.info("[RESUME] Reload best_data from artifact")
            best_data = load_group_best_phases(ART_ROOT, video_id)

        # =========================
        # STEP 13 – BUILD REPORTS
        # =========================
        if start_step <= 13:
            update_video_status_sync(video_id, VideoStatus.STEP_13_BUILD_REPORTS)
            logger.info("=== STEP 13 – BUILD REPORTS ===")

            # ---------- REPORT 1 ----------
            r1 = build_report_1_timeline(phase_units)

            # ---------- REPORT 2 (PHASE INSIGHTS) ----------
            r2_raw = build_report_2_phase_insights_raw(phase_units, best_data)
            r2_gpt = rewrite_report_2_with_gpt(r2_raw)

            for item in r2_gpt:
                upsert_phase_insight_sync(
                    user_id,
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

            group_id = get_video_structure_group_id_of_video_sync(video_id, user_id)
            if not group_id:
                logger.info("[REPORT3] No structure group, skip")
            else:
                best = get_video_structure_group_best_video_sync(group_id, user_id)
                if not best:
                    logger.info("[REPORT3] No benchmark video, skip")
                else:
                    best_video_id = best["video_id"]

                    current_features = get_video_structure_features_sync(video_id, user_id)
                    best_features = get_video_structure_features_sync(best_video_id, user_id)

                    group_stats = get_video_structure_group_stats_sync(group_id, user_id)

                    if not current_features or not best_features:
                        logger.info("[REPORT3] Missing structure features, skip")
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
            logger.info("[SKIP] STEP 13")

        if start_step <= 14:
            update_video_status_sync(video_id, VideoStatus.STEP_14_FINALIZE)
            logger.info("=== STEP 14 – FINALIZE PIPELINE (WAIT SPLIT) ===")

            MAX_WAIT_SEC = 60 * 120   
            CHECK_INTERVAL = 5     

            waited = 0
            while True:
                split_status = get_video_split_status_sync(video_id)

                if split_status == "done":
                    logger.info("[FINALIZE] Split DONE → mark video DONE")
                    update_video_status_sync(video_id, VideoStatus.DONE)
                    break

                if waited >= MAX_WAIT_SEC:
                    raise TimeoutError(
                        f"Wait split timeout after {MAX_WAIT_SEC}s (split_status={split_status})"
                    )

                # logger.info(f"[FINALIZE] Waiting split... current={split_status}")
                logger.info("[FINALIZE] Waiting split... current=%s", split_status)
                time.sleep(CHECK_INTERVAL)
                waited += CHECK_INTERVAL
                

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


    except Exception:
        update_video_status_sync(video_id, VideoStatus.ERROR)
        logger.exception("Video processing failed")
        raise
    finally:
        logger.info("[DB] Closing database connection...")
        close_db_sync()

if __name__ == "__main__":
    main()

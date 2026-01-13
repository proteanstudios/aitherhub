import os
import argparse
import requests
from dotenv import load_dotenv
from ultralytics import YOLO

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
    rewrite_report_2_with_gpt,
    build_report_3_video_insights_raw,
    rewrite_report_3_with_gpt,
    save_reports,
)
from db_ops import (
    upsert_phase_group_sync,
    update_phase_group_for_video_phase_sync,
    upsert_group_best_phase_sync,
    mark_phase_insights_need_refresh_sync,
    clear_phase_insight_need_refresh_sync,
    get_group_best_phase_sync,
    upsert_phase_insight_sync,
    insert_video_insight_sync,
    update_video_status_sync
)

from video_status import VideoStatus

VIDEO_PATH = "uploadedvideo/1_HairDryer.mp4"  # fallback for local quick run
FRAMES_ROOT = "frames"

def _ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def _download_blob(blob_url: str, dest_path: str):
    with requests.get(blob_url, stream=True) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)


def _resolve_inputs(args) -> tuple[str, str]:
    # Determine video_path and video_id from CLI args (prefer queue payload), fallback to default
    video_id = args.video_id
    video_path = args.video_path
    blob_url = args.blob_url

    if video_path:
        # If explicit path is provided, derive id from filename if not set
        if not video_id:
            video_id = os.path.splitext(os.path.basename(video_path))[0]
        return video_path, video_id

    # No explicit path: use video_id (+ optional blob_url) to get a local file
    if not video_id:
        # Fallback to default hardcoded path (local quick run)
        local_path = VIDEO_PATH
        return local_path, os.path.splitext(os.path.basename(local_path))[0]

    local_dir = "uploadedvideo"
    _ensure_dir(local_dir)
    local_path = os.path.join(local_dir, f"{video_id}.mp4")

    if os.path.exists(local_path):
        return local_path, video_id

    if blob_url:
        print(f"[DL] Downloading video from blob: {blob_url}")
        _download_blob(blob_url, local_path)
        return local_path, video_id

    # As a last resort, use default path if present
    if os.path.exists(VIDEO_PATH):
        return VIDEO_PATH, os.path.splitext(os.path.basename(VIDEO_PATH))[0]

    raise FileNotFoundError("No video_path found. Provide --video-path or --video-id with --blob-url, or set envs.")


def main():
    parser = argparse.ArgumentParser(description="Process a livestream video")
    parser.add_argument("--video-id", dest="video_id", type=str, help="Video UUID to process")
    parser.add_argument("--video-path", dest="video_path", type=str, help="Local path to video file")
    parser.add_argument("--blob-url", dest="blob_url", type=str, help="Blob URL (with SAS) to download if needed")
    args = parser.parse_args()

    # Initialize database connection
    print("[DB] Initializing database connection...")
    init_db_sync()

    try:
        video_path, video_id = _resolve_inputs(args)

        # =========================
        # STEP 0 – FRAME EXTRACTION
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_0_EXTRACT_FRAMES)
        print("=== STEP 0 – EXTRACT FRAMES ===")
        frame_dir = extract_frames(
            video_path=video_path,
            fps=1,
            frames_root=FRAMES_ROOT,
        )

        # =========================
        # STEP 1 – PHASE DETECTION
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_1_DETECT_PHASES)
        print("=== STEP 1 – PHASE DETECTION ===")
        model = YOLO("yolov8s.pt", verbose=False)

        keyframes, rep_frames, total_frames = detect_phases(
            frame_dir=frame_dir,
            model=model,
        )

        # =========================
        # STEP 2 – PHASE METRICS
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_2_EXTRACT_METRICS)
        print("=== STEP 2 – PHASE METRICS ===")
        phase_stats = extract_phase_stats(
            keyframes=keyframes,
            total_frames=total_frames,
            frame_dir=frame_dir,
        )

        # =========================
        # STEP 3 – AUDIO → TEXT
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_3_TRANSCRIBE_AUDIO)
        print("=== STEP 3 – AUDIO TO TEXT ===")
        audio_dir = extract_audio_chunks(video_path)
        transcribe_audio_chunks(audio_dir)

        audio_text_dir = os.path.join("audio_text", video_id)

        # =========================
        # STEP 4 – IMAGE CAPTION
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_4_IMAGE_CAPTION)
        print("=== STEP 4 – IMAGE CAPTION ===")
        keyframe_captions = caption_keyframes(
            frame_dir=frame_dir,
            rep_frames=rep_frames,
        )

        # =========================
        # STEP 5 – BUILD PHASE UNITS
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_5_BUILD_PHASE_UNITS)
        print("=== STEP 5 – BUILD PHASE UNITS ===")
        phase_units = build_phase_units(
            keyframes=keyframes,
            rep_frames=rep_frames,
            keyframe_captions=keyframe_captions,
            phase_stats=phase_stats,
            total_frames=total_frames,
            frame_dir=frame_dir,
            audio_text_dir=audio_text_dir,
            video_id=video_id,
        )

        # =========================
        # STEP 6 – PHASE DESCRIPTION
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION)
        print("=== STEP 6 – PHASE DESCRIPTION ===")
        phase_units = build_phase_descriptions(phase_units)

        # phases were inserted inside build_phase_units using the provided video_id

        # =========================
        # STEP 7 – GLOBAL GROUPING
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_7_GROUPING)
        print("=== STEP 7 – GLOBAL PHASE GROUPING ===")
        phase_units = embed_phase_descriptions(phase_units)

        groups = load_global_groups()
        phase_units, groups = assign_phases_to_groups(phase_units, groups)
        save_global_groups(groups)

        # Upsert groups
        for g in groups:
            upsert_phase_group_sync(
                group_id=g["group_id"],
                centroid=g["centroid"].tolist(),
                size=g["size"],
            )

        # Update phases with group_id
        for p in phase_units:
            if p.get("group_id"):
                update_phase_group_for_video_phase_sync(
                    video_id=video_id,
                    phase_index=p["phase_index"],
                    group_id=p["group_id"],
                )


        # =========================
        # STEP 8 – GROUP BEST PHASES
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_8_UPDATE_BEST_PHASE)
        print("=== STEP 8 – GROUP BEST PHASES ===")
        best_data = load_group_best_phases()
        best_data = update_group_best_phases(
            phase_units=phase_units,
            best_data=best_data,
            video_id=video_id,
        )
        save_group_best_phases(best_data)

        for gid, g in best_data["groups"].items():
            if not g["phases"]:
                continue

            gid = int(gid)

            best = g["phases"][0]
            m = best["metrics"]

            new_best_video_id = best["video_id"]
            new_best_phase_index = best["phase_index"]

            #Get old best from DB
            old_video_id, old_phase_index = get_group_best_phase_sync(gid)

            # 1) Upsert best phase
            upsert_group_best_phase_sync(
                group_id=gid,
                video_id=new_best_video_id,
                phase_index=new_best_phase_index,
                score=best["score"],
                view_velocity=m.get("view_velocity"),
                like_velocity=m.get("like_velocity"),
                like_per_viewer=m.get("like_per_viewer"),
            )

            # 2) Only mark dirty if best actually changed
            if (old_video_id, old_phase_index) != (new_best_video_id, new_best_phase_index):
                print(f"[INFO] Best phase changed for group {gid}: marking insights dirty")

                mark_phase_insights_need_refresh_sync(
                    group_id=gid,
                    except_video_id=new_best_video_id,
                    except_phase_index=new_best_phase_index,
                )

                # Ensure new best is marked fresh
                clear_phase_insight_need_refresh_sync(
                    video_id=new_best_video_id,
                    phase_index=new_best_phase_index,
                )


        # =========================
        # STEP 9 – BUILD REPORTS
        # =========================
        update_video_status_sync(video_id, VideoStatus.STEP_9_BUILD_REPORTS)
        print("=== STEP 9 – BUILD REPORTS ===")
        r1 = build_report_1_timeline(phase_units)

        r2_raw = build_report_2_phase_insights_raw(phase_units, best_data)
        r2_gpt = rewrite_report_2_with_gpt(r2_raw)

        
        for item in r2_gpt:
            upsert_phase_insight_sync(
                video_id=video_id,
                phase_index=item["phase_index"],
                group_id=int(item["group_id"]) if item.get("group_id") else None,
                insight=item["insight"],
            )

        r3_raw = build_report_3_video_insights_raw(phase_units)
        r3_gpt = rewrite_report_3_with_gpt(r3_raw)

        save_reports(
            video_id,
            r1,
            r2_raw,
            r2_gpt,
            r3_raw,
            r3_gpt,
        )

        video_insights = r3_gpt.get("video_insights", [])

        for item in video_insights:
            insert_video_insight_sync(
                video_id=video_id,
                title=item.get("title", "").strip(),
                content=item.get("content", "").strip(),
            )

        update_video_status_sync(video_id, VideoStatus.DONE)
        print("\n[SUCCESS] Video processing completed successfully")

    except Exception as e:
        update_video_status_sync(video_id, VideoStatus.ERROR)
        print(f"\n[ERROR] Video processing failed: {e}")
        raise
    finally:
        # Cleanup database connection
        print("[DB] Closing database connection...")
        close_db_sync()


if __name__ == "__main__":
    main()

import os
from ultralytics import YOLO

from vision_pipeline import caption_keyframes
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

VIDEO_PATH = "uploadedvideo/1_HairDryer.mp4"
FRAMES_ROOT = "frames"


def main():
    video_path = VIDEO_PATH
    video_id = os.path.splitext(os.path.basename(video_path))[0]

    # =========================
    # STEP 0 – FRAME EXTRACTION
    # =========================
    print("=== STEP 0 – EXTRACT FRAMES ===")
    frame_dir = extract_frames(
        video_path=video_path,
        fps=1,
        frames_root=FRAMES_ROOT,
    )

    # =========================
    # STEP 1 – PHASE DETECTION
    # =========================
    print("=== STEP 1 – PHASE DETECTION ===")
    model = YOLO("yolov8s.pt", verbose=False)

    keyframes, rep_frames, total_frames = detect_phases(
        frame_dir=frame_dir,
        model=model,
    )

    # =========================
    # STEP 2 – PHASE METRICS
    # =========================
    print("=== STEP 2 – PHASE METRICS ===")
    phase_stats = extract_phase_stats(
        keyframes=keyframes,
        total_frames=total_frames,
        frame_dir=frame_dir,
    )

    # =========================
    # STEP 3 – AUDIO → TEXT
    # =========================
    print("=== STEP 3 – AUDIO TO TEXT ===")
    audio_dir = extract_audio_chunks(video_path)
    transcribe_audio_chunks(audio_dir)

    audio_text_dir = os.path.join("audio_text", video_id)

    # =========================
    # STEP 4 – IMAGE CAPTION
    # =========================
    print("=== STEP 4 – IMAGE CAPTION ===")
    keyframe_captions = caption_keyframes(
        frame_dir=frame_dir,
        rep_frames=rep_frames,
    )

    # =========================
    # STEP 5 – BUILD PHASE UNITS
    # =========================
    print("=== STEP 5 – BUILD PHASE UNITS ===")
    phase_units = build_phase_units(
        keyframes=keyframes,
        rep_frames=rep_frames,
        keyframe_captions=keyframe_captions,
        phase_stats=phase_stats,
        total_frames=total_frames,
        frame_dir=frame_dir,
        audio_text_dir=audio_text_dir,
    )

    # =========================
    # STEP 6 – PHASE DESCRIPTION
    # =========================
    print("=== STEP 6 – PHASE DESCRIPTION ===")
    phase_units = build_phase_descriptions(phase_units)

    # =========================
    # STEP 7 – GLOBAL GROUPING
    # =========================
    print("=== STEP 7 – GLOBAL PHASE GROUPING ===")
    phase_units = embed_phase_descriptions(phase_units)

    groups = load_global_groups()
    phase_units, groups = assign_phases_to_groups(phase_units, groups)
    save_global_groups(groups)

    # =========================
    # STEP 8 – GROUP BEST PHASES
    # =========================
    print("=== STEP 8 – GROUP BEST PHASES ===")
    best_data = load_group_best_phases()
    best_data = update_group_best_phases(
        phase_units=phase_units,
        best_data=best_data,
        video_id=video_id,
    )
    save_group_best_phases(best_data)

    # =========================
    # STEP 9 – BUILD REPORTS
    # =========================
    print("=== STEP 9 – BUILD REPORTS ===")
    r1 = build_report_1_timeline(phase_units)

    r2_raw = build_report_2_phase_insights_raw(phase_units, best_data)
    r2_gpt = rewrite_report_2_with_gpt(r2_raw)

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


if __name__ == "__main__":
    main()

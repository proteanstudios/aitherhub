"""
Generate TikTok-style clip from a video phase.

Steps:
1. Download source video from Azure Blob
2. Cut the specified segment
3. Extract audio and transcribe with Whisper (word-level timestamps)
4. Crop/resize to 9:16 vertical format
5. Burn TikTok-style subtitles (random style)
6. Upload to Azure Blob
7. Update DB with clip URL

Usage:
    python generate_clip.py \
        --clip-id <uuid> \
        --video-id <uuid> \
        --blob-url <sas_url> \
        --time-start 52.0 \
        --time-end 85.0
"""

import os
import sys
import json
import random
import argparse
import logging
import subprocess
import tempfile
import time
import requests
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
project_root = Path(__file__).parent.parent.parent
load_dotenv(project_root / ".env")
load_dotenv()

# Setup logging
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "generate_clip.log"), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("generate_clip")

# Add batch dir to path
BATCH_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BATCH_DIR)

from db_ops import init_db_sync, close_db_sync, get_event_loop, get_session
from split_video import upload_to_blob, parse_blob_url
from sqlalchemy import text

# Environment
WHISPER_ENDPOINT = os.getenv("WHISPER_ENDPOINT")
AZURE_KEY = os.getenv("AZURE_OPENAI_KEY")
FFMPEG_BIN = os.getenv("FFMPEG_PATH", "ffmpeg")

# Font configuration – Noto Sans CJK JP (installed via fonts-noto-cjk package)
JP_FONT_DIR = "/usr/share/fonts/opentype/noto"
JP_FONT_FILE = os.path.join(JP_FONT_DIR, "NotoSansCJK-Black.ttc")
JP_FONT_NAME = "Noto Sans CJK JP Black"  # Name as registered in fontconfig

# Japanese filler words to remove from subtitles
FILLER_WORDS = {
    "えー", "えーと", "えっと", "えーっと",
    "あー", "あのー", "あの", "あのね",
    "うー", "うーん", "うん", "んー", "ん",
    "まあ", "まぁ", "まー",
    "そのー", "その",
    "なんか", "なんかね",
    "ほら", "ほらね",
    "ねー", "ねえ",
    "こう", "こうね",
}

# TikTok subtitle styles
SUBTITLE_STYLES = [
    {
        "name": "bold_white",
        "fontsize": 48,
        "fontcolor": "white",
        "borderw": 4,
        "bordercolor": "black",
        "shadowx": 2,
        "shadowy": 2,
        "shadowcolor": "black@0.5",
    },
    {
        "name": "yellow_pop",
        "fontsize": 52,
        "fontcolor": "yellow",
        "borderw": 5,
        "bordercolor": "black",
        "shadowx": 3,
        "shadowy": 3,
        "shadowcolor": "black@0.6",
    },
    {
        "name": "cyan_glow",
        "fontsize": 46,
        "fontcolor": "#00FFFF",
        "borderw": 4,
        "bordercolor": "#003333",
        "shadowx": 2,
        "shadowy": 2,
        "shadowcolor": "#006666@0.5",
    },
    {
        "name": "pink_bold",
        "fontsize": 50,
        "fontcolor": "#FF69B4",
        "borderw": 5,
        "bordercolor": "black",
        "shadowx": 2,
        "shadowy": 2,
        "shadowcolor": "black@0.5",
    },
    {
        "name": "green_fresh",
        "fontsize": 48,
        "fontcolor": "#00FF88",
        "borderw": 4,
        "bordercolor": "#002200",
        "shadowx": 2,
        "shadowy": 2,
        "shadowcolor": "black@0.5",
    },
]


# =========================
# DB helpers
# =========================

def update_clip_status(clip_id: str, status: str, clip_url: str = None, error_message: str = None):
    """Update clip status in database."""
    loop = get_event_loop()

    async def _update():
        async with get_session() as session:
            if clip_url:
                sql = text("""
                    UPDATE video_clips
                    SET status = :status, clip_url = :clip_url, updated_at = NOW()
                    WHERE id = :clip_id
                """)
                await session.execute(sql, {"status": status, "clip_url": clip_url, "clip_id": clip_id})
            elif error_message:
                sql = text("""
                    UPDATE video_clips
                    SET status = :status, error_message = :error_message, updated_at = NOW()
                    WHERE id = :clip_id
                """)
                await session.execute(sql, {"status": status, "error_message": error_message, "clip_id": clip_id})
            else:
                sql = text("""
                    UPDATE video_clips
                    SET status = :status, updated_at = NOW()
                    WHERE id = :clip_id
                """)
                await session.execute(sql, {"status": status, "clip_id": clip_id})

    loop.run_until_complete(_update())


# =========================
# Download
# =========================

def download_video(blob_url: str, dest_path: str):
    """Download video from Azure Blob."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    logger.info(f"Downloading video to {dest_path}")

    # Try azcopy first
    try:
        azcopy_path = os.getenv("AZCOPY_PATH") or "/usr/local/bin/azcopy"
        result = subprocess.run(
            [azcopy_path, "copy", blob_url, dest_path, "--overwrite=true"],
            check=True, capture_output=True, text=True, timeout=600
        )
        logger.info("AzCopy download succeeded")
        return
    except Exception as e:
        logger.info(f"AzCopy failed, falling back to requests: {e}")

    # Fallback to requests
    with requests.get(blob_url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                if chunk:
                    f.write(chunk)
    logger.info("Download completed via requests")


# =========================
# Cut segment
# =========================

def cut_segment(input_path: str, output_path: str, start_sec: float, end_sec: float) -> bool:
    """Cut a segment from the video with audio."""
    duration = end_sec - start_sec
    if duration <= 0:
        return False

    cmd = [
        FFMPEG_BIN, "-y",
        "-ss", str(start_sec),
        "-i", input_path,
        "-t", str(duration),
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=300)
        return True
    except subprocess.CalledProcessError:
        # Fallback: re-encode
        cmd_reencode = [
            FFMPEG_BIN, "-y",
            "-ss", str(start_sec),
            "-i", input_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ]
        try:
            subprocess.run(cmd_reencode, check=True, capture_output=True, text=True, timeout=600)
            return True
        except Exception as e:
            logger.error(f"Failed to cut segment: {e}")
            return False


# =========================
# Transcribe with Whisper
# =========================

def extract_audio(video_path: str, audio_path: str) -> bool:
    """Extract audio from video as WAV."""
    cmd = [
        FFMPEG_BIN, "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
        return True
    except Exception as e:
        logger.error(f"Failed to extract audio: {e}")
        return False


def transcribe_audio(audio_path: str) -> list:
    """Transcribe audio using Azure Whisper API. Returns list of segments with timestamps."""
    if not WHISPER_ENDPOINT or not AZURE_KEY:
        logger.warning("Whisper endpoint not configured, skipping transcription")
        return []

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    for attempt in range(3):
        try:
            response = requests.post(
                WHISPER_ENDPOINT,
                headers={"api-key": AZURE_KEY},
                files={
                    "file": ("audio.wav", audio_data, "audio/wav"),
                    "response_format": (None, "verbose_json"),
                    "timestamp_granularities[]": (None, "word"),
                    "temperature": (None, "0"),
                    "task": (None, "transcribe"),
                    "language": (None, "ja"),
                },
                timeout=120,
            )

            if response.status_code == 200:
                data = response.json()
                segments = []

                # Use word-level timestamps for TikTok-style subtitles
                words = data.get("words", [])
                if words:
                    # Group words into subtitle lines (max ~8 chars per line for Japanese)
                    current_line = []
                    current_start = None
                    char_count = 0

                    for word in words:
                        w_text = word.get("word", "").strip()
                        if not w_text:
                            continue

                        # Skip filler words
                        if w_text in FILLER_WORDS:
                            logger.debug(f"Skipping filler word: {w_text}")
                            continue

                        if current_start is None:
                            current_start = word.get("start", 0)

                        current_line.append(w_text)
                        char_count += len(w_text)

                        # Break line at ~12 characters for readability
                        if char_count >= 12:
                            segments.append({
                                "start": current_start,
                                "end": word.get("end", 0),
                                "text": "".join(current_line),
                            })
                            current_line = []
                            current_start = None
                            char_count = 0

                    # Remaining words
                    if current_line:
                        segments.append({
                            "start": current_start,
                            "end": words[-1].get("end", 0),
                            "text": "".join(current_line),
                        })
                else:
                    # Fallback to segment-level timestamps
                    for seg in data.get("segments", []):
                        segments.append({
                            "start": seg.get("start", 0),
                            "end": seg.get("end", 0),
                            "text": seg.get("text", "").strip(),
                        })

                logger.info(f"Transcribed {len(segments)} subtitle segments")
                return segments

            elif response.status_code == 429:
                wait_time = 5 * (attempt + 1)
                logger.warning(f"Rate limited, waiting {wait_time}s")
                time.sleep(wait_time)
            else:
                logger.error(f"Whisper API error: {response.status_code} {response.text[:200]}")

        except Exception as e:
            logger.error(f"Transcription attempt {attempt + 1} failed: {e}")
            time.sleep(3)

    return []


# =========================
# Video processing (crop + subtitles)
# =========================

def get_video_dimensions(video_path: str) -> tuple:
    """Get video width and height."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        video_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except Exception as e:
        logger.error(f"Failed to get video dimensions: {e}")
        return 1920, 1080  # Default assumption


def build_ass_subtitle(segments: list, style: dict, video_width: int = 1080, video_height: int = 1920) -> str:
    """Build ASS subtitle file content with TikTok-style formatting."""
    fontsize = style["fontsize"]
    fontcolor_ass = _hex_to_ass_color(style["fontcolor"])
    bordercolor_ass = _hex_to_ass_color(style.get("bordercolor", "black"))
    outline = style.get("borderw", 4)
    shadow = style.get("shadowx", 2)

    # ASS header
    ass_content = f"""[Script Info]
Title: TikTok Clip Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{JP_FONT_NAME},{fontsize},{fontcolor_ass},&H000000FF,{bordercolor_ass},&H80000000,-1,0,0,0,100,100,0,0,1,{outline},{shadow},2,40,40,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    for seg in segments:
        start_time = _seconds_to_ass_time(seg["start"])
        end_time = _seconds_to_ass_time(seg["end"])
        text = seg["text"].replace("\n", "\\N")
        ass_content += f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{text}\n"

    return ass_content


def _hex_to_ass_color(color: str) -> str:
    """Convert hex color or named color to ASS color format (&HAABBGGRR)."""
    color_map = {
        "white": "&H00FFFFFF",
        "black": "&H00000000",
        "yellow": "&H0000FFFF",
        "red": "&H000000FF",
    }
    if color.lower() in color_map:
        return color_map[color.lower()]

    # Handle hex colors like #FF69B4
    color = color.lstrip("#")
    if "@" in color:
        color = color.split("@")[0].lstrip("#")

    if len(color) == 6:
        r, g, b = color[0:2], color[2:4], color[4:6]
        return f"&H00{b}{g}{r}"

    return "&H00FFFFFF"


def _seconds_to_ass_time(seconds: float) -> str:
    """Convert seconds to ASS time format (H:MM:SS.CC)."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def create_vertical_clip(
    input_path: str,
    output_path: str,
    segments: list,
    style: dict,
) -> bool:
    """Create 9:16 vertical clip with burned-in subtitles."""
    width, height = get_video_dimensions(input_path)
    logger.info(f"Source video: {width}x{height}")

    # Target: 1080x1920 (9:16)
    target_w, target_h = 1080, 1920

    # Calculate crop dimensions to get 9:16 from source
    source_ratio = width / height
    target_ratio = target_w / target_h  # 0.5625

    if source_ratio > target_ratio:
        # Source is wider - crop width, keep height
        crop_h = height
        crop_w = int(height * target_ratio)
        crop_x = (width - crop_w) // 2
        crop_y = 0
    else:
        # Source is taller - crop height, keep width
        crop_w = width
        crop_h = int(width / target_ratio)
        crop_x = 0
        crop_y = (height - crop_h) // 2

    # Build ASS subtitle file
    ass_path = input_path + ".ass"
    ass_content = build_ass_subtitle(segments, style, target_w, target_h)
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)

    logger.info(f"Created ASS subtitle file: {ass_path}")

    # FFmpeg command: crop → scale → burn subtitles
    # Use fontsdir to point FFmpeg to the Noto Sans CJK JP font directory
    ass_path_escaped = ass_path.replace("'", "'\\''")
    filter_complex = (
        f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
        f"scale={target_w}:{target_h}:flags=lanczos,"
        f"ass='{ass_path_escaped}':fontsdir='{JP_FONT_DIR}'"
    )

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", input_path,
        "-vf", filter_complex,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-movflags", "+faststart",
        "-r", "30",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            logger.error(f"FFmpeg stderr: {result.stderr[-500:]}")
            # Try without ASS subtitles (drawtext fallback)
            return create_vertical_clip_drawtext(input_path, output_path, segments, style,
                                                  crop_w, crop_h, crop_x, crop_y, target_w, target_h)
        logger.info("Vertical clip created successfully with ASS subtitles")
        return True
    except Exception as e:
        logger.error(f"FFmpeg failed: {e}")
        return create_vertical_clip_drawtext(input_path, output_path, segments, style,
                                              crop_w, crop_h, crop_x, crop_y, target_w, target_h)
    finally:
        # Cleanup ASS file
        if os.path.exists(ass_path):
            os.remove(ass_path)


def create_vertical_clip_drawtext(
    input_path: str,
    output_path: str,
    segments: list,
    style: dict,
    crop_w: int, crop_h: int, crop_x: int, crop_y: int,
    target_w: int, target_h: int,
) -> bool:
    """Fallback: create clip using drawtext filter instead of ASS."""
    logger.info("Falling back to drawtext subtitles")

    fontsize = style["fontsize"]
    fontcolor = style["fontcolor"]
    borderw = style.get("borderw", 4)

    # Build drawtext filter chain
    vf_parts = [
        f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}",
        f"scale={target_w}:{target_h}:flags=lanczos",
    ]

    # Use the Noto Sans CJK JP font file for drawtext
    font_file = JP_FONT_FILE
    if not os.path.exists(font_file):
        logger.warning(f"Font file not found: {font_file}, trying fc-match")
        try:
            result = subprocess.run(["fc-match", "Noto Sans CJK JP:style=Black", "-f", "%{file}"],
                                   capture_output=True, text=True, timeout=5)
            if result.returncode == 0 and result.stdout.strip():
                font_file = result.stdout.strip()
        except Exception:
            pass

    for seg in segments:
        text = seg["text"].replace("'", "'\\''").replace(":", "\\:")
        start = seg["start"]
        end = seg["end"]
        vf_parts.append(
            f"drawtext=text='{text}'"
            f":fontfile='{font_file}'"
            f":fontsize={fontsize}"
            f":fontcolor={fontcolor}"
            f":borderw={borderw}"
            f":bordercolor=black"
            f":x=(w-text_w)/2"
            f":y=h*0.75"
            f":enable='between(t,{start},{end})'"
        )

    vf = ",".join(vf_parts)

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", input_path,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-movflags", "+faststart",
        "-r", "30",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            logger.error(f"drawtext FFmpeg stderr: {result.stderr[-500:]}")
            # Last resort: just crop without subtitles
            return create_vertical_clip_nosub(input_path, output_path,
                                               crop_w, crop_h, crop_x, crop_y, target_w, target_h)
        logger.info("Vertical clip created with drawtext subtitles")
        return True
    except Exception as e:
        logger.error(f"drawtext FFmpeg failed: {e}")
        return create_vertical_clip_nosub(input_path, output_path,
                                           crop_w, crop_h, crop_x, crop_y, target_w, target_h)


def create_vertical_clip_nosub(
    input_path: str, output_path: str,
    crop_w: int, crop_h: int, crop_x: int, crop_y: int,
    target_w: int, target_h: int,
) -> bool:
    """Last resort: create vertical clip without subtitles."""
    logger.info("Creating vertical clip without subtitles")

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", input_path,
        "-vf", f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={target_w}:{target_h}:flags=lanczos",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        logger.info("Vertical clip created (no subtitles)")
        return True
    except Exception as e:
        logger.error(f"Final FFmpeg attempt failed: {e}")
        return False


# =========================
# Main pipeline
# =========================

def generate_clip(clip_id: str, video_id: str, blob_url: str, time_start: float, time_end: float):
    """Main clip generation pipeline."""
    logger.info(f"=== Starting clip generation ===")
    logger.info(f"clip_id={clip_id}, video_id={video_id}")
    logger.info(f"time_range={time_start:.1f}s - {time_end:.1f}s")

    # Initialize DB
    init_db_sync()

    # Update status to processing
    update_clip_status(clip_id, "processing")

    work_dir = tempfile.mkdtemp(prefix=f"clip_{clip_id}_")
    logger.info(f"Work directory: {work_dir}")

    try:
        # 1. Download source video
        source_path = os.path.join(work_dir, "source.mp4")
        download_video(blob_url, source_path)

        if not os.path.exists(source_path) or os.path.getsize(source_path) == 0:
            raise RuntimeError("Failed to download source video")

        # 2. Cut segment
        segment_path = os.path.join(work_dir, "segment.mp4")
        logger.info("Cutting segment...")
        if not cut_segment(source_path, segment_path, time_start, time_end):
            raise RuntimeError("Failed to cut segment")

        # 3. Extract audio and transcribe
        audio_path = os.path.join(work_dir, "audio.wav")
        segments = []
        if extract_audio(segment_path, audio_path):
            segments = transcribe_audio(audio_path)
            logger.info(f"Got {len(segments)} subtitle segments")
        else:
            logger.warning("Audio extraction failed, proceeding without subtitles")

        # 4. Choose random TikTok style
        style = random.choice(SUBTITLE_STYLES)
        logger.info(f"Selected subtitle style: {style['name']}")

        # 5. Create vertical clip with subtitles
        clip_path = os.path.join(work_dir, "clip_final.mp4")
        if not create_vertical_clip(segment_path, clip_path, segments, style):
            raise RuntimeError("Failed to create vertical clip")

        if not os.path.exists(clip_path) or os.path.getsize(clip_path) == 0:
            raise RuntimeError("Output clip file is empty")

        logger.info(f"Clip created: {os.path.getsize(clip_path)} bytes")

        # 6. Upload to Azure Blob
        blob_info = parse_blob_url(blob_url)
        ts_str = f"{time_start:.0f}"
        te_str = f"{time_end:.0f}"
        clip_blob_name = f"{blob_info['parent_path']}/clips/clip_{ts_str}_{te_str}.mp4" if blob_info['parent_path'] else f"clips/clip_{ts_str}_{te_str}.mp4"

        logger.info(f"Uploading clip to blob: {clip_blob_name}")
        uploaded_url = upload_to_blob(clip_path, clip_blob_name)

        if not uploaded_url:
            raise RuntimeError("Failed to upload clip to blob storage")

        logger.info(f"Clip uploaded: {uploaded_url}")

        # 7. Update DB with completed status
        update_clip_status(clip_id, "completed", clip_url=uploaded_url)
        logger.info("=== Clip generation completed successfully ===")

    except Exception as e:
        logger.exception(f"Clip generation failed: {e}")
        update_clip_status(clip_id, "failed", error_message=str(e)[:500])

    finally:
        # Cleanup work directory
        try:
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)
            logger.info(f"Cleaned up work directory: {work_dir}")
        except Exception:
            pass

        close_db_sync()


# =========================
# CLI entry point
# =========================

def main():
    parser = argparse.ArgumentParser(description="Generate TikTok-style clip")
    parser.add_argument("--clip-id", required=True, help="Clip record UUID")
    parser.add_argument("--video-id", required=True, help="Source video UUID")
    parser.add_argument("--blob-url", required=True, help="Source video blob URL (with SAS)")
    parser.add_argument("--time-start", type=float, required=True, help="Start time in seconds")
    parser.add_argument("--time-end", type=float, required=True, help="End time in seconds")

    args = parser.parse_args()

    generate_clip(
        clip_id=args.clip_id,
        video_id=args.video_id,
        blob_url=args.blob_url,
        time_start=args.time_start,
        time_end=args.time_end,
    )


if __name__ == "__main__":
    main()

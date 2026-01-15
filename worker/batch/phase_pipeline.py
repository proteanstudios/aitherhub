# phase_pipeline.py
import os
import base64
import json
import time
import random

from db_ops import insert_video_phase_sync
from openai import AzureOpenAI
from decouple import config


# ======================================================
# ENV & OPENAI CLIENT
# ======================================================

def env(key, default=None):
    """
    Read env variable with fallback to .env config.
    """
    return os.getenv(key) or config(key, default=default)


OPENAI_API_KEY = env("AZURE_OPENAI_KEY")
AZURE_OPENAI_ENDPOINT = env("AZURE_OPENAI_ENDPOINT")
GPT5_API_VERSION = env("GPT5_API_VERSION")
GPT5_MODEL = env("GPT5_MODEL")

# Max number of frames to scan forward/backward
# when GPT fails to read viewer_count at phase boundary
MAX_FALLBACK = 20


client = AzureOpenAI(
    api_key=OPENAI_API_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=GPT5_API_VERSION
)


# ======================================================
# GPT VISION UTILS
# ======================================================

def safe_json_load(text):
    """
    Safely parse JSON returned by GPT.
    Handles:
    - empty response
    - markdown fenced JSON ```json ... ```
    """
    if not text:
        return None

    text = text.strip()

    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def encode_image(path):
    """
    Read image file and encode to base64
    for GPT Vision input.
    """
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


# def gpt_read_header(image_path):
#     """
#     STEP 2 – GPT Vision header reader

#     Read ONLY viewer_count and like_count from
#     TikTok livestream UI, strictly by screen position.
#     """
#     img_b64 = encode_image(image_path)

#     prompt = """
# Phân tích ảnh livestream TikTok và trích xuất CHỈ 2 giá trị sau, dựa 100% vào VỊ TRÍ:

# viewer_count:
# - Số ở GÓC TRÊN BÊN PHẢI
# - Nằm cạnh cụm avatar tròn
# - Không nhầm với số gift / rank

# like_count:
# - Nằm trong profile card ở GÓC TRÊN BÊN TRÁI
# - Ngay dưới tên chủ phòng
# - Có thể có K / M

# Nếu không thấy đúng vị trí → trả null.

# Chỉ trả JSON:
# {"viewer_count": number | null, "like_count": number | null}
# """.strip()

#     resp = client.responses.create(
#         model=GPT5_MODEL,
#         input=[{
#             "role": "user",
#             "content": [
#                 {"type": "input_text", "text": prompt},
#                 {
#                     "type": "input_image",
#                     "image_url": f"data:image/jpeg;base64,{img_b64}"
#                 }
#             ]
#         }],
#         max_output_tokens=1024
#     )

#     return safe_json_load(resp.output_text)

def gpt_read_header(image_path):
    """
    STEP 2 – GPT Vision header reader

    Read ONLY viewer_count and like_count from
    TikTok livestream UI, strictly by screen position.
    """
    print(f"[VISION] START {image_path}")
    t0 = time.time()

    img_b64 = encode_image(image_path)

    prompt = """
Phân tích ảnh livestream TikTok và trích xuất CHỈ 2 giá trị sau, dựa 100% vào VỊ TRÍ:

viewer_count:
- Số ở GÓC TRÊN BÊN PHẢI
- Nằm cạnh cụm avatar tròn
- Không nhầm với số gift / rank

like_count:
- Nằm trong profile card ở GÓC TRÊN BÊN TRÁI
- Ngay dưới tên chủ phòng
- Có thể có K / M

Nếu không thấy đúng vị trí → trả null.

Chỉ trả JSON:
{"viewer_count": number | null, "like_count": number | null}
""".strip()

    resp = client.responses.create(
        model=GPT5_MODEL,
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {
                    "type": "input_image",
                    "image_url": f"data:image/jpeg;base64,{img_b64}"
                }
            ]
        }],
        max_output_tokens=1024
    )

    dt = time.time() - t0
    print(f"[VISION] END {image_path} in {dt:.1f}s")

    return safe_json_load(resp.output_text)


# ======================================================
# FALLBACK LOGIC FOR PHASE BOUNDARIES
# ======================================================

# def read_phase_start(files, frame_dir, frame_idx):
#     """
#     Try to read viewer_count at phase START.
#     If GPT fails, scan forward up to MAX_FALLBACK frames.
#     """
#     for i in range(MAX_FALLBACK):
#         idx = frame_idx + i
#         if idx >= len(files):
#             break

#         path = os.path.join(frame_dir, files[idx])
#         data = gpt_read_header(path)

#         # if data and data.get("viewer_count") is not None:
#         #     return data, idx

#         if data and (
#             data.get("viewer_count") is not None
#             or data.get("like_count") is not None
#         ):
#             return data, idx

#     return None, frame_idx
def read_phase_start(files, frame_dir, frame_idx):
    """
    Try to read viewer_count and like_count at phase START.
    Fallback forward up to MAX_FALLBACK frames until we get both or reach limit.
    """
    best = {"viewer_count": None, "like_count": None}
    best_idx = frame_idx

    for i in range(MAX_FALLBACK):
        idx = frame_idx + i
        if idx >= len(files):
            break

        path = os.path.join(frame_dir, files[idx])
        data = gpt_read_header(path)

        if isinstance(data, dict):
            if best["viewer_count"] is None and data.get("viewer_count") is not None:
                best["viewer_count"] = data.get("viewer_count")
                best_idx = idx

            if best["like_count"] is None and data.get("like_count") is not None:
                best["like_count"] = data.get("like_count")
                best_idx = idx

        # If we already have both, stop early
        if best["viewer_count"] is not None and best["like_count"] is not None:
            break

    if best["viewer_count"] is not None or best["like_count"] is not None:
        return best, best_idx

    return None, frame_idx



# def read_phase_end(files, frame_dir, frame_idx):
#     """
#     Try to read viewer_count at phase END.
#     If GPT fails, scan backward up to MAX_FALLBACK frames.
#     """
#     for i in range(MAX_FALLBACK):
#         idx = frame_idx - i
#         if idx < 0:
#             break

#         path = os.path.join(frame_dir, files[idx])
#         data = gpt_read_header(path)

#         if data and data.get("viewer_count") is not None:
#             return data, idx

#     return None, frame_idx
def read_phase_end(files, frame_dir, frame_idx):
    """
    Try to read viewer_count and like_count at phase END.
    Fallback backward up to MAX_FALLBACK frames until we get both or reach limit.
    """
    best = {"viewer_count": None, "like_count": None}
    best_idx = frame_idx

    for i in range(MAX_FALLBACK):
        idx = frame_idx - i
        if idx < 0:
            break

        path = os.path.join(frame_dir, files[idx])
        data = gpt_read_header(path)

        if isinstance(data, dict):
            if best["viewer_count"] is None and data.get("viewer_count") is not None:
                best["viewer_count"] = data.get("viewer_count")
                best_idx = idx

            if best["like_count"] is None and data.get("like_count") is not None:
                best["like_count"] = data.get("like_count")
                best_idx = idx

        # If we already have both, stop early
        if best["viewer_count"] is not None and best["like_count"] is not None:
            break

    if best["viewer_count"] is not None or best["like_count"] is not None:
        return best, best_idx

    return None, frame_idx


# ======================================================
# STEP 2 – EXTRACT PHASE STATS (ENTRY)
# ======================================================

def extract_phase_stats(
    keyframes,
    total_frames,
    frame_dir,
):
    """
    STEP 2 – Extract phase-level metrics using GPT Vision.

    For each phase:
    - read viewer_count / like_count at start
    - read viewer_count / like_count at end
    - apply forward/backward fallback if needed
    """
    files = sorted(os.listdir(frame_dir))
    results = []

    # Build phase ranges from keyframes
    extended = [0] + keyframes + [total_frames]

    for i in range(len(extended) - 1):
        start = extended[i]
        end = extended[i + 1] - 1

        start_data, start_used = read_phase_start(files, frame_dir, start)
        end_data, end_used = read_phase_end(files, frame_dir, end)

        results.append({
            "phase_index": i + 1,
            "phase_start_frame": start,
            "phase_start_used_frame": start_used,
            "start": start_data,
            "phase_end_frame": end,
            "phase_end_used_frame": end_used,
            "end": end_data
        })

        # Throttle GPT Vision calls (same as code cũ)
        # time.sleep(random.uniform(0.5, 1.2))
        time.sleep(0.05)

    return results


# ======================================================
# STEP 5 – BUILD PHASE UNITS
# ======================================================

def load_all_audio_segments(audio_text_dir):
    """
    Load all audio transcription segments from audio_text folder.

    Parse [TIMELINE] section:
    <start>s → <end>s : <text>
    """
    segments = []

    for f in sorted(os.listdir(audio_text_dir)):
        if not f.endswith(".txt"):
            continue

        with open(os.path.join(audio_text_dir, f), "r", encoding="utf-8") as fin:
            lines = fin.readlines()

        in_timeline = False
        for line in lines:
            line = line.strip()

            if line == "[TIMELINE]":
                in_timeline = True
                continue

            if not in_timeline or "→" not in line:
                continue

            try:
                time_part, text = line.split(":", 1)
                start_s, end_s = time_part.replace("s", "").split("→")

                segments.append({
                    "start": float(start_s.strip()),
                    "end": float(end_s.strip()),
                    "text": text.strip()
                })
            except Exception:
                continue

    return segments


def collect_speech_for_phase(segments, start_sec, end_sec):
    """
    Collect all speech text overlapping with
    [start_sec, end_sec] of a phase.
    """
    texts = []

    for seg in segments:
        if seg["end"] < start_sec:
            continue
        if seg["start"] > end_sec:
            break

        texts.append(seg["text"])

    return " ".join(texts)

def build_phase_units(
    keyframes,
    rep_frames,
    keyframe_captions,
    phase_stats,
    total_frames,
    frame_dir,
    audio_text_dir,
    video_id: str | None = None,
):
    """
    STEP 5 – Build phase units.

    Merge:
    - phase boundaries
    - representative frame
    - image caption
    - audio speech text
    - viewer/like metrics
    """
    audio_segments = load_all_audio_segments(audio_text_dir)
    files = sorted(os.listdir(frame_dir))

    phase_units = []

    for i, ps in enumerate(phase_stats):
        start_sec = ps["phase_start_frame"]
        end_sec = ps["phase_end_frame"]

        speech_text = collect_speech_for_phase(
            audio_segments,
            start_sec,
            end_sec
        )

        # rep_frames/keyframe_captions may have length = number_of_phases - 1
        # When missing, fallback to middle frame of the phase.
        if i < len(rep_frames):
            rep_idx = rep_frames[i]
        else:
            rep_idx = int((start_sec + end_sec) // 2)
            rep_idx = max(0, min(rep_idx, len(files) - 1))

        if i < len(keyframe_captions):
            caption = keyframe_captions[i]["caption"]
        else:
            caption = ""

        phase = {
            "phase_index": i + 1,

            "time_range": {
                "start_sec": start_sec,
                "end_sec": end_sec
            },

            "key_frame": {
                "frame_index": rep_idx,
                "image": files[rep_idx]
            },

            "image_caption": caption,
            "speech_text": speech_text,

            "metric_timeseries": {
                "start": ps["start"],
                "end": ps["end"],
                "start_used_frame": ps["phase_start_used_frame"],
                "end_used_frame": ps["phase_end_used_frame"]
            }
        }

        # Persist immediately so caller can have DB-generated phase_id
        if video_id:
            try:
                start = ps.get("start") or {}
                end = ps.get("end") or {}

                view_start = start.get("viewer_count") if isinstance(start, dict) else None
                view_end = end.get("viewer_count") if isinstance(end, dict) else None
                like_start = start.get("like_count") if isinstance(start, dict) else None
                like_end = end.get("like_count") if isinstance(end, dict) else None

                delta_view = None
                delta_like = None
                try:
                    if view_start is not None and view_end is not None:
                        delta_view = int(view_end - view_start)
                except Exception:
                    delta_view = None

                try:
                    if like_start is not None and like_end is not None:
                        delta_like = int(like_end - like_start)
                except Exception:
                    delta_like = None

                time_start = float(start_sec) if start_sec is not None else None
                time_end = float(end_sec) if end_sec is not None else None

                new_id = insert_video_phase_sync(
                    video_id=str(video_id),
                    phase_index=phase["phase_index"],
                    phase_description=None,
                    time_start=time_start,
                    time_end=time_end,
                    view_start=view_start,
                    view_end=view_end,
                    like_start=like_start,
                    like_end=like_end,
                    delta_view=delta_view,
                    delta_like=delta_like,
                )
                phase["phase_id"] = new_id
            except Exception as e:
                print(f"[DB][WARN] Could not insert phase now: {e}")

        phase_units.append(phase)

    return phase_units


# ======================================================
# STEP 6 – PHASE DESCRIPTION PROMPT
# ======================================================

# SYSTEM_PROMPT_PHASE_DESC = """
# Bạn là một hệ thống phân tích livestream bán hàng.

# Bạn sẽ nhận dữ liệu của MỘT phase, gồm HAI phần trong user input:
# 1) IMAGE CAPTION:
#    - Là mô tả hình ảnh đại diện của phase
#    - Chỉ phản ánh trạng thái trực quan (có/không có trình bày sản phẩm, mức độ cận cảnh, v.v.)

# 2) SPEECH TEXT:
#    - Là nội dung lời nói của người dẫn trong phase đó
#    - Phản ánh hành vi, mục đích và vai trò của phase trong livestream

# Nhiệm vụ của bạn:
# Tạo một PHASE DESCRIPTION nhằm phục vụ việc SO SÁNH và NHÓM các phase giống nhau.

# YÊU CẦU:
# - Viết 4–6 câu
# - Mô tả hành vi chính của người dẫn trong phase
# - Mô tả trạng thái trình bày sản phẩm (nếu có, không suy đoán)
# - Cho biết vai trò của lời nói (giải thích, demo, kêu gọi, nói chuyện, filler, chuyển tiếp)
# - Không nhắc tên sản phẩm cụ thể nếu hình ảnh không cho thấy rõ
# - Không nhắc giá, số liệu, thời gian, viewer, like
# - Không đưa ra nhận xét hay đánh giá

# Mục tiêu là để các phase có hành vi và cách trình bày tương tự
# sẽ có mô tả tương tự về mặt ngữ nghĩa.

# Output JSON:
# {
#   "phase_description": "string"
# }
# """.strip()

SYSTEM_PROMPT_PHASE_DESC = """
あなたはライブコマース配信を分析するシステムです。

あなたは1つのフェーズについて、以下の情報を受け取ります。

1) IMAGE CAPTION:
   - フェーズを代表する画像の視覚的な説明
   - 見た目の状態のみを反映する

2) SPEECH TEXT:
   - そのフェーズ中の配信者の発話内容
   - 行動や役割を反映する

タスク：
フェーズ同士を比較・分類するための
PHASE DESCRIPTIONを作成してください。

要件：
- 4〜6文
- 配信者の主な行動を説明する
- 商品を提示・説明・デモしているかを記述する（推測しない）
- 話し方の役割（説明、デモ、呼びかけ、雑談など）を示す
- 商品名、価格、数値、時間、視聴者数は書かない
- 評価や感想は書かない

出力（JSON）：
{
  "phase_description": "string"
}
""".strip()

def build_phase_descriptions(phase_units):
    """
    STEP 6 – Build phase descriptions (ORIGINAL LOGIC).

    - 1 phase = 1 GPT call
    - system + user prompt
    - output JSON { phase_description }
    - no retry loop
    """

    for phase in phase_units:
        user_input = f"""
IMAGE CAPTION:
{phase.get("image_caption", "")}

SPEECH TEXT:
{phase.get("speech_text", "")}
""".strip()

        phase_desc = None

        try:
            resp = client.responses.create(
                model=GPT5_MODEL,
                input=[
                    {
                        "role": "system",
                        "content": [
                            {
                                "type": "input_text",
                                "text": SYSTEM_PROMPT_PHASE_DESC
                            }
                        ]
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": user_input
                            }
                        ]
                    }
                ],
                max_output_tokens=2048
            )

            raw = resp.output_text
            data = safe_json_load(raw)

            if data and "phase_description" in data:
                phase_desc = data["phase_description"]

        except Exception:
            phase_desc = None

        if not phase_desc:
            # phase_desc = (
            #     "Phase này bao gồm hoạt động trình bày và giao tiếp trong livestream. "
            #     "Người dẫn đang tương tác và cung cấp thông tin liên quan đến nội dung đang hiển thị."
            # )
            phase_desc = (
                "このフェーズでは、配信者が視聴者とやり取りしながら、"
                "画面に表示されている内容に関連する説明や進行を行っている。"
                "詳細な説明は処理制限により取得できなかった。"
            )

        phase["phase_description"] = phase_desc

        # sleep nhẹ giống code gốc
        # time.sleep(random.uniform(0.8, 1.5))
        time.sleep(0.1)

    return phase_units



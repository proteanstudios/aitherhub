# phase_pipeline.py
import os
import base64
import json
import time
import random

from db_ops import insert_video_phase_sync
from openai import AzureOpenAI, RateLimitError, APIError, APITimeoutError
from decouple import config
import asyncio
from functools import partial

MAX_CONCURRENCY = 8


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


async def gpt_read_header_async(
    image_path: str,
    sem: asyncio.Semaphore,
    max_retry: int = 3,
):
    """
    Async wrapper for gpt_read_header with:
    - semaphore concurrency control
    - retry on rate-limit / transient errors
    - exponential backoff + jitter

    Return:
    - parsed JSON dict
    - or None if all retries fail
    """

    async with sem:
        loop = asyncio.get_event_loop()

        for attempt in range(max_retry):
            try:
                return await loop.run_in_executor(
                    None,
                    partial(gpt_read_header, image_path)
                )

            except (RateLimitError, APITimeoutError, APIError) as e:
                sleep_time = (2 ** attempt) + random.uniform(0, 0.5)
                print(
                    f"[VISION][RETRY] {image_path} "
                    f"attempt {attempt + 1}/{max_retry}, "
                    f"sleep {sleep_time:.1f}s ({type(e).__name__})"
                )
                await asyncio.sleep(sleep_time)

            except Exception as e:
                # lỗi không xác định → không retry vô hạn
                print(f"[VISION][ERROR] {image_path}: {e}")
                return None

        print(f"[VISION][FAIL] {image_path} after {max_retry} retries")
        return None

async def process_one_task(task, files, frame_dir, sem, phase_results):
    phase_idx = task["phase_index"]
    role = task["role"]
    frame_idx = task["frame_idx"]

    if frame_idx < 0 or frame_idx >= len(files):
        return

    path = os.path.join(frame_dir, files[frame_idx])
    data = await gpt_read_header_async(path, sem)

    if phase_idx not in phase_results:
        phase_results[phase_idx] = {}

    phase_results[phase_idx][role] = data
    phase_results[phase_idx][f"{role}_used_frame"] = frame_idx

def merge_stat(best, data):
    """
    Merge viewer_count / like_count vào best.
    Return True nếu best đã đủ cả 2.
    """
    if not isinstance(data, dict):
        return False

    if best["viewer_count"] is None and data.get("viewer_count") is not None:
        best["viewer_count"] = data["viewer_count"]

    if best["like_count"] is None and data.get("like_count") is not None:
        best["like_count"] = data["like_count"]

    return best["viewer_count"] is not None and best["like_count"] is not None

async def process_phase_role(
    phase_index,
    role,
    base_idx,
    files,
    frame_dir,
    sem,
    phase_results,
):

    best = {"viewer_count": None, "like_count": None}
    used_idx = base_idx  # mặc định là frame gốc

    offsets = range(0, MAX_FALLBACK + 1)

    for off in offsets:
        idx = base_idx + off if role == "start" else base_idx - off
        if idx < 0 or idx >= len(files):
            continue

        path = os.path.join(frame_dir, files[idx])

        # semaphore + retry đã nằm trong gpt_read_header_async
        data = await gpt_read_header_async(path, sem)

        if isinstance(data, dict):
            before = dict(best)
            done = merge_stat(best, data)

            # chỉ update used_idx khi có tiến triển
            if best != before:
                used_idx = idx

            # nếu đã đủ viewer + like thì dừng sớm
            if done:
                break

        # nhường event loop để phase khác có cơ hội chạy
        await asyncio.sleep(0)

    if phase_index not in phase_results:
        phase_results[phase_index] = {}

    phase_results[phase_index][role] = (
        best if (best["viewer_count"] is not None or best["like_count"] is not None)
        else None
    )
    phase_results[phase_index][f"{role}_used_frame"] = used_idx




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




def extract_phase_stats(keyframes, total_frames, frame_dir):
    files = sorted(os.listdir(frame_dir))
    extended = [0] + keyframes + [total_frames]

    phase_results = {}

    async def runner():
        sem = asyncio.Semaphore(MAX_CONCURRENCY)
        tasks = []

        for i in range(len(extended) - 1):
            start = extended[i]
            end = extended[i + 1] - 1
            phase_idx = i + 1

            tasks.append(
                process_phase_role(
                    phase_idx, "start", start,
                    files, frame_dir, sem, phase_results
                )
            )
            tasks.append(
                process_phase_role(
                    phase_idx, "end", end,
                    files, frame_dir, sem, phase_results
                )
            )

        await asyncio.gather(*tasks)

    asyncio.run(runner())

    results = []
    for i in range(len(extended) - 1):
        idx = i + 1
        r = phase_results.get(idx, {})

        results.append({
            "phase_index": idx,
            "phase_start_frame": extended[i],
            "phase_start_used_frame": r.get("start_used_frame"),
            "start": r.get("start"),
            "phase_end_frame": extended[i + 1] - 1,
            "phase_end_used_frame": r.get("end_used_frame"),
            "end": r.get("end"),
        })

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

# def build_phase_descriptions(phase_units):
#     """
#     STEP 6 – Build phase descriptions (ORIGINAL LOGIC).

#     - 1 phase = 1 GPT call
#     - system + user prompt
#     - output JSON { phase_description }
#     - no retry loop
#     """

#     for phase in phase_units:
#         user_input = f"""
# IMAGE CAPTION:
# {phase.get("image_caption", "")}

# SPEECH TEXT:
# {phase.get("speech_text", "")}
# """.strip()

#         phase_desc = None

#         try:
#             resp = client.responses.create(
#                 model=GPT5_MODEL,
#                 input=[
#                     {
#                         "role": "system",
#                         "content": [
#                             {
#                                 "type": "input_text",
#                                 "text": SYSTEM_PROMPT_PHASE_DESC
#                             }
#                         ]
#                     },
#                     {
#                         "role": "user",
#                         "content": [
#                             {
#                                 "type": "input_text",
#                                 "text": user_input
#                             }
#                         ]
#                     }
#                 ],
#                 max_output_tokens=2048
#             )

#             raw = resp.output_text
#             data = safe_json_load(raw)

#             if data and "phase_description" in data:
#                 phase_desc = data["phase_description"]

#         except Exception:
#             phase_desc = None

#         if not phase_desc:
#             # phase_desc = (
#             #     "Phase này bao gồm hoạt động trình bày và giao tiếp trong livestream. "
#             #     "Người dẫn đang tương tác và cung cấp thông tin liên quan đến nội dung đang hiển thị."
#             # )
#             phase_desc = (
#                 "このフェーズでは、配信者が視聴者とやり取りしながら、"
#                 "画面に表示されている内容に関連する説明や進行を行っている。"
#                 "詳細な説明は処理制限により取得できなかった。"
#             )

#         phase["phase_description"] = phase_desc

#         # sleep nhẹ giống code gốc
#         # time.sleep(random.uniform(0.8, 1.5))
#         time.sleep(0.1)

#     return phase_units

def build_phase_descriptions(phase_units):
    results = {}

    async def runner():
        sem = asyncio.Semaphore(MAX_CONCURRENCY)
        tasks = []

        for phase in phase_units:
            tasks.append(
                process_one_phase_desc_task(
                    phase,
                    sem,
                    results,
                )
            )

        await asyncio.gather(*tasks)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        fut = asyncio.run_coroutine_threadsafe(runner(), loop)
        fut.result()
    else:
        asyncio.run(runner())

    for phase in phase_units:
        phase["phase_description"] = results.get(phase["phase_index"])

    return phase_units


def gpt_phase_description(image_caption: str, speech_text: str):
    user_input = f"""
IMAGE CAPTION:
{image_caption or ""}

SPEECH TEXT:
{speech_text or ""}
""".strip()

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

    return safe_json_load(resp.output_text)

async def gpt_phase_description_async(
    image_caption: str,
    speech_text: str,
    sem: asyncio.Semaphore,
    max_retry: int = 3,
):
    async with sem:
        loop = asyncio.get_event_loop()

        for attempt in range(max_retry):
            try:
                return await loop.run_in_executor(
                    None,
                    partial(
                        gpt_phase_description,
                        image_caption,
                        speech_text,
                    )
                )

            except (RateLimitError, APITimeoutError, APIError):
                sleep_time = (2 ** attempt) + random.uniform(0, 0.5)
                await asyncio.sleep(sleep_time)

            except Exception:
                return None

        return None

async def process_one_phase_desc_task(
    phase,
    sem,
    results,
):
    data = await gpt_phase_description_async(
        phase.get("image_caption"),
        phase.get("speech_text"),
        sem,
    )

    if isinstance(data, dict) and "phase_description" in data:
        results[phase["phase_index"]] = data["phase_description"]
    else:
        results[phase["phase_index"]] = (
        "このフェーズでは、配信者が視聴者とやり取りしながら、"
        "画面に表示されている内容に関連する説明や進行を行っている。"
        "詳細な説明は処理制限により取得できなかった。"
    )




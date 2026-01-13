import os
import time
import random
import base64
import json

from openai import AzureOpenAI
from decouple import config


# =========================
# ENV & CLIENT
# =========================

def env(key, default=None):
    return os.getenv(key) or config(key, default=default)


OPENAI_API_KEY = env("AZURE_OPENAI_KEY")
AZURE_OPENAI_ENDPOINT = env("AZURE_OPENAI_ENDPOINT")
GPT5_API_VERSION = env("GPT5_API_VERSION")
GPT5_MODEL = env("GPT5_MODEL")

MAX_RETRY = 10


client = AzureOpenAI(
    api_key=OPENAI_API_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=GPT5_API_VERSION
)


# =========================
# UTILS
# =========================

def safe_json_load(text):
    if not text:
        return None

    text = text.strip()

    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def encode_image(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


# =========================
# STEP 4 – GPT IMAGE CAPTION
# =========================

def gpt_image_caption(image_path):
    img_b64 = encode_image(image_path)

    # ===== PROMPT GỐC – KHÔNG ĐƯỢC SỬA =====
    prompt = """
Ảnh này là một key frame đại diện cho MỘT PHASE trong livestream bán hàng.

Hãy mô tả trạng thái trực quan của phase này,
theo cách phù hợp để SO SÁNH và NHÓM các phase giống nhau.

YÊU CẦU:
- Chỉ mô tả những gì NHÌN THẤY
- Tập trung vào:
  + Sản phẩm có đang được trình bày / cầm / demo hay không
  + Mức độ tập trung của camera vào sản phẩm
  + Trạng thái chung của khung hình
- KHÔNG suy đoán cảm xúc, ý định, hiệu quả
- KHÔNG nhắc tới thời gian, số liệu, hay người xem

Chỉ trả JSON:
{
  "visual_phase_description": "string"
}
""".strip()
    # =====================================

    for attempt in range(1, MAX_RETRY + 1):
        try:
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

            raw = resp.output_text
            data = safe_json_load(raw)

            if data:
                return data

        except Exception:
            pass

        wait = 2 * attempt + random.uniform(0.5, 1.5)
        print(f"[RETRY] caption retry #{attempt}, sleep {wait:.1f}s")
        time.sleep(wait)

    return None


# =========================
# STEP 4 – ENTRY POINT
# =========================

def caption_keyframes(
    frame_dir: str,
    rep_frames: list[int],
):
    files = sorted(os.listdir(frame_dir))
    results = []

    for idx in rep_frames:
        img_path = os.path.join(frame_dir, files[idx])

        caption_data = gpt_image_caption(img_path)

        results.append({
            "frame_index": idx,
            "image": files[idx],
            "caption": (
                caption_data.get("visual_phase_description")
                if caption_data else None
            )
        })

        # sleep giống code gốc
        time.sleep(0.3)

    return results

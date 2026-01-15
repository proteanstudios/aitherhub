import json
import os
import time
import random

from openai import AzureOpenAI
from decouple import config
from best_phase_pipeline import extract_attention_metrics


# ======================================================
# ENV / CLIENT
# ======================================================

def env(key, default=None):
    return os.getenv(key) or config(key, default=default)


GPT5_MODEL = env("GPT5_MODEL")
AZURE_OPENAI_ENDPOINT = env("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_KEY = env("AZURE_OPENAI_KEY")
GPT5_API_VERSION = env("GPT5_API_VERSION")

client = AzureOpenAI(
    api_key=AZURE_OPENAI_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=GPT5_API_VERSION
)

MAX_RETRY = 5


# ======================================================
# REPORT 1 – TIMELINE / PHASE BREAKDOWN
# ======================================================

def build_report_1_timeline(phase_units):
    """
    Build timeline report for frontend rendering.
    No GPT involved.
    """
    out = []

    for p in phase_units:
        start = p["metric_timeseries"]["start"] or {}
        end   = p["metric_timeseries"]["end"] or {}

        out.append({
            "phase_index": p["phase_index"],
            "group_id": p.get("group_id"),
            "phase_description": p["phase_description"],
            "time_range": p["time_range"],
            "metrics": {
                "view_start": start.get("viewer_count"),
                "view_end": end.get("viewer_count"),
                "like_start": start.get("like_count"),
                "like_end": end.get("like_count"),
                "delta_view": (
                    end.get("viewer_count") - start.get("viewer_count")
                    if start.get("viewer_count") is not None
                    and end.get("viewer_count") is not None
                    else None
                ),
                "delta_like": (
                    end.get("like_count") - start.get("like_count")
                    if start.get("like_count") is not None
                    and end.get("like_count") is not None
                    else None
                )
            }
        })

    return out


# ======================================================
# REPORT 2 – PHASE INSIGHTS (RAW)
# ======================================================

def build_report_2_phase_insights_raw(phase_units, best_data):
    """
    Compare each phase with the best historical phase
    of the same group using rule-based metrics.
    """
    out = []

    for p in phase_units:
        gid = p.get("group_id")
        if not gid:
            continue

        gid = str(gid)
        best_group = best_data["groups"].get(gid)
        if not best_group or not best_group["phases"]:
            continue

        best = best_group["phases"][0]

        cur = extract_attention_metrics(p)
        ref = best["metrics"]

        findings = []

        if cur["view_velocity"] is not None and ref["view_velocity"] is not None:
            if cur["view_velocity"] < ref["view_velocity"]:
                findings.append("view_velocity_lower_than_best")

        if cur["like_per_viewer"] is not None and ref["like_per_viewer"] is not None:
            if cur["like_per_viewer"] < ref["like_per_viewer"]:
                findings.append("like_per_viewer_lower_than_best")

        out.append({
            "phase_index": p["phase_index"],
            "group_id": gid,
            "phase_description": p["phase_description"],
            "current_metrics": cur,
            "benchmark_metrics": ref,
            "findings": findings
        })

    return out


# ======================================================
# REPORT 2 – GPT REWRITE (PROMPT GỐC)
# ======================================================

# PROMPT_REPORT_2 = """
# You are analyzing a livestream phase.

# You are given:
# - The phase description
# - Metric comparison results against the best historical phase of the same type

# Rules:
# - Do NOT calculate metrics
# - Do NOT invent data
# - Only explain what can be improved
# - Be concrete and actionable

# Write 2–4 bullet points.
# """.strip()

def is_gpt_report_2_invalid(text: str) -> bool:
    if not text:
        return True

    t = text.strip().lower()

    refusal_signals = [
        # EN
        "i’m sorry",
        "i am sorry",
        "cannot assist",
        "can’t assist",
        "cannot help",
        "cannot comply",
        "not able to help",

        # JP
        "申し訳ありません",
        "対応できません",
        "お手伝いできません",
    ]

    return any(sig in t for sig in refusal_signals)


PROMPT_REPORT_2 = """
あなたはライブコマース分析の専門家です。

以下は、あるフェーズの説明と、
同タイプの過去ベストフェーズとの指標比較結果です。

ルール：
- 指標を再計算しない
- データを捏造しない
- 改善できる点のみを述べる
- 抽象的な表現を避け、具体的に書く

2〜4個の箇条書きで出力してください。

入力：
{data}
""".strip()


# def rewrite_report_2_with_gpt(raw_items):
#     out = []

#     for item in raw_items:
#         payload = json.dumps(item, ensure_ascii=False)
#         insight = None

#         for attempt in range(1, MAX_RETRY + 1):
#             resp = client.responses.create(
#                 model=GPT5_MODEL,
#                 input=[
#                     {
#                         "role": "system",
#                         "content": [
#                             {
#                                 "type": "input_text",
#                                 "text": "You are analyzing a livestream phase."
#                             }
#                         ]
#                     },
#                     {
#                         "role": "user",
#                         "content": [
#                             {
#                                 "type": "input_text",
#                                 "text": PROMPT_REPORT_2 + "\n\nINPUT:\n" + payload
#                             }
#                         ]
#                     }
#                 ],
#                 max_output_tokens=2048
#             )

#             text = resp.output_text.strip() if resp.output_text else ""
#             if text:
#                 insight = text
#                 break

#             time.sleep(2 * attempt)

#         if not insight:
#             insight = "- No clear improvement points could be identified from the current data."

#         out.append({
#             "phase_index": item["phase_index"],
#             "group_id": item["group_id"],
#             "insight": insight
#         })

#     return out

def rewrite_report_2_with_gpt(raw_items):
    out = []

    for item in raw_items:
        payload = json.dumps(item, ensure_ascii=False)
        insight_text = None

        for attempt in range(1, MAX_RETRY + 1):
            resp = client.responses.create(
                model=GPT5_MODEL,
                input=[
                    {
                        "role": "system",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "You are analyzing a livestream phase."
                            }
                        ]
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": PROMPT_REPORT_2.format(data=payload)
                            }
                        ]
                    }
                ],
                max_output_tokens=2048
            )

            text = resp.output_text.strip() if resp.output_text else ""

            # ===== DEMO CORE CHECK =====
            if not is_gpt_report_2_invalid(text):
                insight_text = text
                break

            # retry + backoff nhẹ (giống demo)
            wait = 2 * attempt + random.uniform(0.5, 1.5)
            time.sleep(wait)

        # ===== HARD FALLBACK (JP – PRODUCT SAFE) =====
        if not insight_text:
            insight_text = (
                "このフェーズについては、"
                "現在の比較データから明確な改善ポイントを特定することができません。"
                "今後、追加の配信データが蓄積され次第、"
                "より具体的な改善提案が可能になります。"
            )

        out.append({
            "phase_index": item["phase_index"],
            "group_id": item["group_id"],
            "insight": insight_text
        })

    return out

# ======================================================
# REPORT 3 – VIDEO INSIGHTS (RAW)
# ======================================================

def build_report_3_video_insights_raw(phase_units):
    groups = {}

    for p in phase_units:
        gid = p.get("group_id")
        if not gid:
            continue

        gid = str(gid)
        m = extract_attention_metrics(p)

        g = groups.setdefault(gid, {
            "phase_count": 0,
            "total_delta_view": 0,
            "total_delta_like": 0
        })

        g["phase_count"] += 1

        if m["delta_view"] is not None:
            g["total_delta_view"] += m["delta_view"]

        if m["delta_like"] is not None:
            g["total_delta_like"] += m["delta_like"]

    return {
        "total_phases": len(phase_units),
        "group_performance": [
            {
                "group_id": gid,
                "phase_count": g["phase_count"],
                "total_delta_view": g["total_delta_view"],
                "total_delta_like": g["total_delta_like"]
            }
            for gid, g in groups.items()
        ]
    }


# ======================================================
# REPORT 3 – GPT REWRITE (PROMPT GỐC)
# ======================================================

# PROMPT_REPORT_3 = """
# Bạn đang phân tích HIỆU QUẢ TỔNG THỂ của một video livestream bán hàng.

# YÊU CẦU BẮT BUỘC:
# - Viết bằng TIẾNG VIỆT
# - KHÔNG nhắc đến group_id
# - KHÔNG bịa số liệu
# - Mỗi insight là MỘT object riêng

# FORMAT OUTPUT JSON (BẮT BUỘC):
# {
#   "video_insights": [
#     {
#       "title": "string ngắn gọn",
#       "content": "mô tả insight vài câu"
#     }
#   ]
# }
# """.strip()

# PROMPT_REPORT_3 = """
# Bạn đang phân tích HIỆU QUẢ TỔNG THỂ của một video livestream bán hàng.

# Bạn được cung cấp:
# - Dữ liệu tổng hợp hiệu quả theo từng nhóm phase
# - KHÔNG có dữ liệu time-series chi tiết

# NHIỆM VỤ:
# - Phân tích cấu trúc video
# - Chỉ ra điểm mạnh, điểm yếu
# - Đưa ra gợi ý cải thiện ở mức tổng thể

# YÊU CẦU BẮT BUỘC:
# - Viết bằng TIẾNG VIỆT
# - KHÔNG nhắc đến group_id
# - KHÔNG bịa số liệu
# - Mỗi insight là MỘT object riêng

# FORMAT OUTPUT JSON (BẮT BUỘC):
# {
#   "video_insights": [
#     {
#       "title": "string ngắn gọn",
#       "content": "mô tả insight vài câu"
#     }
#   ]
# }

# INPUT DATA:
# {data}
# """

PROMPT_REPORT_3 = """
あなたはライブコマース動画全体の【構造と総合的なパフォーマンス】を分析する専門家です。

提供される情報：
- フェーズタイプごとの集計パフォーマンス
- 詳細な時系列データは【含まれていません】

タスク：
- 動画全体の構成を俯瞰的に分析する
- 構造上の強み・弱みを明確にする
- どのタイプのフェーズが成果に貢献しているか、
  またはパフォーマンスを阻害しているかを説明する
- 構成・流れ・テンポに関する改善案を提案する

【必須ルール】：
- 数値を捏造しない
- group_id や内部IDを【一切】言及しない
- 入力データに含まれない事実を推測しない
- 出力は【必ず JSON のみ】とする
- 各インサイトは【1オブジェクト＝1インサイト】とする

出力形式（厳守）：
{
  "video_insights": [
    {
      "title": "短く要点を示すタイトル",
      "content": "インサイトの説明（数文）"
    }
  ]
}

入力データ：
{data}
""".strip()



# def rewrite_report_3_with_gpt(raw_video_insight):
#     payload = json.dumps(raw_video_insight, ensure_ascii=False)

#     resp = client.responses.create(
#         model=GPT5_MODEL,
#         input=[
#             {
#                 "role": "system",
#                 "content": [
#                     {
#                         "type": "input_text",
#                         "text": "Bạn đang phân tích hiệu quả tổng thể của một video livestream bán hàng."
#                     }
#                 ]
#             },
#             {
#                 "role": "user",
#                 "content": [
#                     {
#                         "type": "input_text",
#                         "text": PROMPT_REPORT_3 + "\n\nINPUT:\n" + payload
#                     }
#                 ]
#             }
#         ],
#         max_output_tokens=2048
#     )

#     try:
#         parsed = json.loads(resp.output_text)
#         if "video_insights" in parsed:
#             return parsed
#     except Exception:
#         pass

#     return {
#         "video_insights": [
#             {
#                 "title": "Không thể phân tích",
#                 "content": "GPT không trả về đúng định dạng mong muốn."
#             }
#         ]
#     }

def safe_json_load(text):
    if not text:
        return None

    text = text.strip()

    if text.startswith("```"):
        lines = text.splitlines()
        # bỏ dòng ```json
        if lines[0].startswith("```"):
            lines = lines[1:]
        # bỏ dòng ```
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None

def rewrite_report_3_with_gpt(raw_video_insight):
    payload = json.dumps(raw_video_insight, ensure_ascii=False)

    # Style demo: inject data qua placeholder
    prompt = PROMPT_REPORT_3.replace("{data}", payload)

    resp = client.responses.create(
        model=GPT5_MODEL,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt
                    }
                ]
            }
        ],
        max_output_tokens=2048
    )

    parsed = safe_json_load(resp.output_text)

    if parsed and "video_insights" in parsed:
        return parsed

    # Fallback cứng để không làm gãy pipeline
    return {
        "video_insights": [
            {
                "title": "Không thể phân tích",
                "content": "GPT không trả về đúng định dạng mong muốn."
            }
        ]
    }


# ======================================================
# SAVE REPORTS
# ======================================================

def save_reports(video_id, r1, r2_raw, r2_gpt, r3_raw, r3_gpt):
    out_dir = os.path.join("report", video_id)
    os.makedirs(out_dir, exist_ok=True)

    def dump(name, obj):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    dump("report_1_timeline.json", r1)
    dump("report_2_phase_insights_raw.json", r2_raw)
    dump("report_2_phase_insights_gpt.json", r2_gpt)
    dump("report_3_video_insights_raw.json", r3_raw)
    dump("report_3_video_insights_gpt.json", r3_gpt)

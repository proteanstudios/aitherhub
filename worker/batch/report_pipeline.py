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


# =========================================================
# STRUCTURE FEATURE COMPARATORS (for Report 3)
# =========================================================

STRUCTURE_FEATURE_TYPES = {
    "phase_count": "scalar",
    "avg_phase_duration": "scalar",
    "switch_rate": "scalar",

    "early_ratio": "distribution",
    "mid_ratio": "distribution",
    "late_ratio": "distribution",

    "structure_embedding": "vector",
}


def compare_scalar(a, b):
    try:
        if a is None or b is None or b == 0:
            return 0.0
        return (float(a) - float(b)) / float(b)
    except Exception:
        return 0.0


def compare_distribution(a: dict, b: dict):
    if not isinstance(a, dict) or not isinstance(b, dict):
        return 0.0

    keys = set(a.keys()) | set(b.keys())
    dist = 0.0
    for k in keys:
        try:
            dist += abs(float(a.get(k, 0.0)) - float(b.get(k, 0.0)))
        except Exception:
            pass
    return dist


def cosine_distance(a: list, b: list):
    if not isinstance(a, list) or not isinstance(b, list) or not a or not b:
        return 0.0

    try:
        import math

        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))

        if na == 0 or nb == 0:
            return 0.0

        return 1.0 - dot / (na * nb)
    except Exception:
        return 0.0


def compare_feature(feature_name, cur_v, ref_v):
    t = STRUCTURE_FEATURE_TYPES.get(feature_name)

    if t == "scalar":
        return compare_scalar(cur_v, ref_v)

    if t == "distribution":
        return compare_distribution(cur_v, ref_v)

    if t == "vector":
        return cosine_distance(cur_v, ref_v)

    return None



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


# def build_report_3_structure_vs_benchmark_raw(
#     current_features: dict,
#     best_features: dict,
#     group_stats: dict | None = None,
# ):
#     """
#     Deterministic, rule-based.
#     Compare current video structure vs benchmark video structure.
#     Output: JSON-like dict, language-agnostic.
#     """

#     def pct(a, b):
#         if not b:
#             return None
#         return (a - b) / b

#     result = {
#         "type": "video_structure_vs_benchmark",
#         "metrics": {},
#         "judgements": [],
#         "problems": [],
#         "suggestions": [],
#     }

#     # ---------- Pacing ----------
#     cur_avg = current_features.get("avg_phase_duration", 0)
#     best_avg = best_features.get("avg_phase_duration", 0)

#     if best_avg > 0:
#         delta = pct(cur_avg, best_avg)
#         result["metrics"]["avg_phase_duration"] = {
#             "current": cur_avg,
#             "benchmark": best_avg,
#             "delta_ratio": delta,
#         }

#         if delta is not None and delta > 0.25:
#             result["judgements"].append("pacing_slower_than_benchmark")
#             result["problems"].append("average_phase_duration_too_long")
#             result["suggestions"].append("shorten_each_phase_to_increase_pacing")
#         elif delta is not None and delta < -0.25:
#             result["judgements"].append("pacing_faster_than_benchmark")
#         else:
#             result["judgements"].append("pacing_similar_to_benchmark")

#     # ---------- Switch rate ----------
#     cur_switch = current_features.get("phase_switch_rate", 0)
#     best_switch = best_features.get("phase_switch_rate", 0)

#     if best_switch > 0:
#         delta = pct(cur_switch, best_switch)
#         result["metrics"]["phase_switch_rate"] = {
#             "current": cur_switch,
#             "benchmark": best_switch,
#             "delta_ratio": delta,
#         }

#         if delta is not None and delta < -0.3:
#             result["problems"].append("phase_switch_too_infrequent")
#             result["suggestions"].append("increase_phase_switch_frequency")

#     # ---------- Structure balance ----------
#     for key in ["early_ratio", "mid_ratio", "late_ratio"]:
#         cur_v = current_features.get(key)
#         best_v = best_features.get(key)
#         if cur_v is None or best_v is None:
#             continue

#         delta = pct(cur_v, best_v)
#         result["metrics"][key] = {
#             "current": cur_v,
#             "benchmark": best_v,
#             "delta_ratio": delta,
#         }

#         if delta is not None and abs(delta) > 0.3:
#             result["problems"].append(f"{key}_distribution_deviates_from_benchmark")
#             result["suggestions"].append(f"adjust_{key}_distribution_toward_benchmark")

#     # ---------- Complexity ----------
#     cur_n_phase = current_features.get("num_phases", 0)
#     best_n_phase = best_features.get("num_phases", 0)

#     if best_n_phase > 0:
#         delta = pct(cur_n_phase, best_n_phase)
#         result["metrics"]["num_phases"] = {
#             "current": cur_n_phase,
#             "benchmark": best_n_phase,
#             "delta_ratio": delta,
#         }

#         if delta is not None and delta < -0.3:
#             result["problems"].append("too_few_phases_compared_to_benchmark")
#             result["suggestions"].append("increase_number_of_phases_or_segments")
#         elif delta is not None and delta > 0.5:
#             result["problems"].append("too_many_phases_compared_to_benchmark")
#             result["suggestions"].append("merge_or_simplify_phases")

#     # ---------- Overall judgement ----------
#     if result["problems"]:
#         result["overall"] = "structure_quality_worse_than_benchmark"
#     else:
#         result["overall"] = "structure_quality_similar_or_better_than_benchmark"

#     return result

def build_report_3_structure_vs_benchmark_raw(
    current_features: dict,
    best_features: dict,
    group_stats: dict | None = None,
):
    """
    Deterministic, rule-based.
    Compare current video structure vs benchmark video structure.
    Output: JSON-like dict, language-agnostic.
    """

    FEATURES = [
        "phase_count",
        "avg_phase_duration",
        "switch_rate",
        "early_ratio",
        "mid_ratio",
        "late_ratio",
        "structure_embedding",
    ]

    result = {
        "type": "video_structure_vs_benchmark",
        "metrics": {},
        "judgements": [],
        "problems": [],
        "suggestions": [],
    }

    # =====================================================
    # 1) Compare each feature with BEST and GROUP
    # =====================================================
    for k in FEATURES:
        cur_v = current_features.get(k)
        best_v = best_features.get(k)
        group_v = group_stats.get(k) if group_stats else None

        delta_vs_best = compare_feature(k, cur_v, best_v)
        delta_vs_group = compare_feature(k, cur_v, group_v)

        result["metrics"][k] = {
            "type": STRUCTURE_FEATURE_TYPES.get(k),
            "current": cur_v,
            "benchmark": best_v,
            "group": group_v,
            "delta_vs_best": delta_vs_best,
            "delta_vs_group": delta_vs_group,
        }

    # =====================================================
    # 2) Rule-based judgements (use ONLY scalar metrics)
    # =====================================================

    # ---------- Pacing ----------
    d = result["metrics"].get("avg_phase_duration", {})
    delta = d.get("delta_vs_best")
    if isinstance(delta, (int, float)):
        if delta > 0.25:
            result["judgements"].append("pacing_slower_than_benchmark")
            result["problems"].append("average_phase_duration_too_long")
            result["suggestions"].append("shorten_each_phase_to_increase_pacing")
        elif delta < -0.25:
            result["judgements"].append("pacing_faster_than_benchmark")
        else:
            result["judgements"].append("pacing_similar_to_benchmark")

    # ---------- Switch rate ----------
    d = result["metrics"].get("switch_rate", {})
    delta = d.get("delta_vs_best")
    if isinstance(delta, (int, float)):
        if delta < -0.3:
            result["problems"].append("phase_switch_too_infrequent")
            result["suggestions"].append("increase_phase_switch_frequency")

    # ---------- Complexity (phase_count) ----------
    d = result["metrics"].get("phase_count", {})
    delta = d.get("delta_vs_best")
    if isinstance(delta, (int, float)):
        if delta < -0.3:
            result["problems"].append("too_few_phases_compared_to_benchmark")
            result["suggestions"].append("increase_number_of_phases_or_segments")
        elif delta > 0.5:
            result["problems"].append("too_many_phases_compared_to_benchmark")
            result["suggestions"].append("merge_or_simplify_phases")

    # ---------- Structure balance (distribution distance) ----------
    for key in ["early_ratio", "mid_ratio", "late_ratio"]:
        d = result["metrics"].get(key, {})
        dist = d.get("delta_vs_best")
        if isinstance(dist, (int, float)) and dist > 0.3:
            result["problems"].append(f"{key}_distribution_deviates_from_benchmark")
            result["suggestions"].append(f"adjust_{key}_distribution_toward_benchmark")

    # =====================================================
    # 3) Overall judgement
    # =====================================================
    if result["problems"]:
        result["overall"] = "structure_quality_worse_than_benchmark"
    else:
        result["overall"] = "structure_quality_similar_or_better_than_benchmark"

    return result


# PROMPT_REPORT_3_STRUCTURE = """
# あなたはライブコマース動画の「構造品質」を分析する専門家です。

# 以下は：
# - 現在の動画と、同じ構造グループ内のベンチマーク動画の「構造比較RAWデータ」です。

# あなたのタスク：
# - RAWデータの内容のみを使って、動画制作者向けの実用的なフィードバックレポートを書いてください。
# - テンポ、構成バランス、複雑さ、全体の流れに注目してください。
# - 改善点がある場合は、必ず具体的な改善アドバイスを含めてください。

# ルール：
# - 数値を捏造しない
# - 入力にない事実を推測しない
# - 内部システムやIDの話をしない
# - 出力は必ず JSON 形式

# 出力形式：
# {
#   "video_insights": [
#     {
#       "title": "短いタイトル",
#       "content": "数文の説明"
#     }
#   ]
# }

# 入力RAWデータ：
# {data}
# """.strip()

PROMPT_REPORT_3_STRUCTURE = """
あなたはライブコマース動画の【構成・脚本・テンポ設計】を改善するプロのディレクターです。

以下は、この動画の「構造的な特徴」を数値化・要約したデータです。
（※内部的には比較分析された結果ですが、その事実には一切言及しないでください）

あなたの役割：
- この動画の構成を「脚本・演出の観点」からレビューする
- どんなタイプの構成の動画かを言語化する
- どこが良くできているかを説明する
- どこを直すと、もっと良くなるかを【具体的な演出・構成レベル】でアドバイスする

重要なルール：
- 「ベンチマーク」「他の動画」「平均」などの言葉を一切使わない
- 数値や内部指標の話をしない
- 視聴者体験と構成設計の観点でのみ語る
- コンサルではなく、現場の演出家の口調で書く
- 出力は必ず JSON のみ

出力形式：
{
  "video_insights": [
    {
      "title": "短く要点を示すタイトル",
      "content": "構成や脚本に対する具体的なフィードバックと改善案（数文）"
    }
  ]
}

入力データ：
{data}
""".strip()

def rewrite_report_3_structure_with_gpt(raw_struct_report: dict):
    payload = json.dumps(raw_struct_report, ensure_ascii=False, indent=2)
    prompt = PROMPT_REPORT_3_STRUCTURE.replace("{data}", payload)

    # Dùng đúng hàm GPT đang dùng trong report_pipeline hiện tại
    # Ví dụ:
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

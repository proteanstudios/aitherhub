"""
product_detection_pipeline.py
─────────────────────────────
v3: 音声先行検出 + 最小画像補完 = 60-120分 → 1-2分

アーキテクチャ:
  Phase 1: 音声トランスクリプトから商品言及時間帯を特定（API不要、即座）
  Phase 2: 売上データ（CSV）から売上発生時間帯を特定（API不要、即座）
  Phase 3: 音声で特定できなかった「空白時間帯」のみ画像分析（ごく少数のAPI呼び出し）
  Phase 4: 全結果を統合・フィルタ・ブランド名補完

入力:
  - frame_dir   : 1秒ごとに抽出されたフレーム画像のディレクトリ
  - product_list : [{"product_name": "...", "brand_name": "...", "image_url": "..."}, ...]
  - transcription_segments : Whisperの文字起こし結果 (任意)
  - excel_data   : Excelから読み込んだ売上データ (任意)

出力:
  - exposures : [{"product_name", "brand_name", "time_start", "time_end", "confidence"}, ...]
"""

import os
import re
import json
import time
import random
import base64
import asyncio
import logging
from functools import partial
from openai import AzureOpenAI, RateLimitError, APIError, APITimeoutError
from dotenv import load_dotenv
from decouple import config

load_dotenv()
logger = logging.getLogger("product_detection")

# ─── ENV & CLIENT ───────────────────────────────────────────
MAX_CONCURRENCY = 20  # v3: 3→20 に引き上げ（画像分析は少数なので安全）

def env(key, default=None):
    return os.getenv(key) or config(key, default=default)

OPENAI_API_KEY = env("AZURE_OPENAI_KEY")
AZURE_OPENAI_ENDPOINT = env("AZURE_OPENAI_ENDPOINT")
GPT5_API_VERSION = env("GPT5_API_VERSION")
GPT5_MODEL = env("GPT5_MODEL")

client = AzureOpenAI(
    api_key=OPENAI_API_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=GPT5_API_VERSION,
)


# ─── UTILS ──────────────────────────────────────────────────
def encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def safe_json_load(text: str):
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


# ─── PRODUCT KEYWORD MAP ──────────────────────────────────
def build_product_keyword_map(product_list: list[dict]) -> dict[str, list[str]]:
    """
    商品名からキーワードマップを構築。
    部分一致用に複数キーワードを生成する。
    """
    product_keywords: dict[str, list[str]] = {}
    for p in product_list:
        name = p.get("product_name", p.get("name", p.get("商品名", p.get("商品タイトル", ""))))
        if not name:
            continue
        keywords = []
        # フルネーム
        keywords.append(name.lower())
        # ブランド名
        brand = p.get("brand_name", p.get("brand", p.get("ブランド名", p.get("ブランド", ""))))
        if brand:
            keywords.append(brand.lower())
        # 商品名を分割してキーワード化（3文字以上の単語）
        words = re.split(r'[\s　・/\-]+', name)
        for w in words:
            w = w.strip().lower()
            skip_words = {'kyogoku', 'the', 'and', 'for', 'pro', '用', '式', '型'}
            if len(w) >= 3 and w not in skip_words:
                keywords.append(w)
        product_keywords[name] = list(set(keywords))
    return product_keywords


# ═══════════════════════════════════════════════════════════
# PHASE 1: 音声トランスクリプトから商品言及を検出（API不要）
# ═══════════════════════════════════════════════════════════
def detect_from_transcription(
    transcription_segments: list[dict],
    product_keywords: dict[str, list[str]],
    merge_gap: float = 15.0,
    min_duration: float = 5.0,
) -> list[dict]:
    """
    音声トランスクリプトから商品名の言及を検出し、
    連続する言及を統合してexposureセグメントを生成する。

    Returns: [{"product_name", "time_start", "time_end", "confidence", "source": "audio"}]
    """
    if not transcription_segments or not product_keywords:
        return []

    # 各商品の言及タイムスタンプを収集
    product_mentions: dict[str, list[tuple[float, float, int]]] = {}

    for seg in transcription_segments:
        text_lower = seg.get("text", "").lower()
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)

        if not text_lower.strip():
            continue

        for product_name, keywords in product_keywords.items():
            match_count = 0
            for kw in keywords:
                if kw in text_lower and len(kw) >= 3:
                    match_count += 1

            if match_count > 0:
                if product_name not in product_mentions:
                    product_mentions[product_name] = []
                product_mentions[product_name].append((seg_start, seg_end, match_count))

    # 各商品について連続する言及を統合
    exposures = []
    for product_name, mentions in product_mentions.items():
        if not mentions:
            continue

        mentions.sort(key=lambda x: x[0])

        # 連続区間をグループ化
        seg_start = mentions[0][0]
        seg_end = mentions[0][1]
        total_matches = mentions[0][2]
        mention_count = 1

        for i in range(1, len(mentions)):
            m_start, m_end, m_count = mentions[i]
            if m_start - seg_end <= merge_gap:
                # 連続している → 延長
                seg_end = max(seg_end, m_end)
                total_matches += m_count
                mention_count += 1
            else:
                # ギャップ → 新しいセグメント
                duration = seg_end - seg_start
                if duration >= min_duration:
                    # confidence: 言及回数に基づく（多いほど高い）
                    conf = min(0.95, 0.60 + mention_count * 0.05 + total_matches * 0.02)
                    exposures.append({
                        "product_name": product_name,
                        "brand_name": "",
                        "time_start": max(0, seg_start - 5.0),  # 少し前から開始
                        "time_end": seg_end + 5.0,               # 少し後まで延長
                        "confidence": round(conf, 2),
                        "audio_confirmed": True,
                        "source": "audio",
                        "mention_count": mention_count,
                    })
                seg_start = m_start
                seg_end = m_end
                total_matches = m_count
                mention_count = 1

        # 最後のセグメント
        duration = seg_end - seg_start
        if duration >= min_duration:
            conf = min(0.95, 0.60 + mention_count * 0.05 + total_matches * 0.02)
            exposures.append({
                "product_name": product_name,
                "brand_name": "",
                "time_start": max(0, seg_start - 5.0),
                "time_end": seg_end + 5.0,
                "confidence": round(conf, 2),
                "audio_confirmed": True,
                "source": "audio",
                "mention_count": mention_count,
            })

    logger.info(
        "[PRODUCT-v3] Audio detection: found %d exposures for %d/%d products",
        len(exposures), len(product_mentions), len(product_keywords),
    )
    return exposures


# ═══════════════════════════════════════════════════════════
# PHASE 2: 売上データから商品露出時間帯を推定（API不要）
# ═══════════════════════════════════════════════════════════
def detect_from_sales_data(
    excel_data: dict | None,
    product_keywords: dict[str, list[str]],
    time_offset_seconds: float = 0,
) -> list[dict]:
    """
    売上データ（CSV/Excel）から、売上が発生した時間帯に
    対応する商品の露出を推定する。

    売上が発生した = その前後で商品が紹介されていた可能性が高い

    Returns: [{"product_name", "time_start", "time_end", "confidence", "source": "sales"}]
    """
    if not excel_data or not excel_data.get("has_trend_data"):
        return []

    trends = excel_data.get("trends", [])
    if not trends:
        return []

    try:
        from csv_slot_filter import _find_key, KPI_ALIASES
    except ImportError:
        logger.warning("[PRODUCT-v3] csv_slot_filter not available, skipping sales detection")
        return []

    sample = trends[0]
    time_key = _find_key(sample, KPI_ALIASES.get("time", []))
    product_name_key = _find_key(sample, KPI_ALIASES.get("product_name", []))
    order_key = _find_key(sample, KPI_ALIASES.get("order_count", []))
    gmv_key = _find_key(sample, KPI_ALIASES.get("gmv", []))

    if not time_key:
        logger.info("[PRODUCT-v3] No time column found in sales data")
        return []

    # 時間パース
    def parse_time(val) -> float | None:
        if val is None:
            return None
        try:
            from csv_slot_filter import _parse_time_to_seconds
            return _parse_time_to_seconds(val)
        except Exception:
            return None

    # 売上が発生したタイムスロットを収集
    exposures = []
    for entry in trends:
        t_sec = parse_time(entry.get(time_key))
        if t_sec is None:
            continue

        # 動画内の時間に変換
        video_time = t_sec - time_offset_seconds
        if video_time < 0:
            continue

        # 注文があったかチェック
        orders = 0
        if order_key:
            try:
                orders = int(float(entry.get(order_key, 0) or 0))
            except (ValueError, TypeError):
                orders = 0

        gmv = 0
        if gmv_key:
            try:
                gmv = float(entry.get(gmv_key, 0) or 0)
            except (ValueError, TypeError):
                gmv = 0

        if orders <= 0 and gmv <= 0:
            continue

        # 商品名がCSVにある場合
        product_name = None
        if product_name_key:
            raw_name = entry.get(product_name_key, "")
            if raw_name:
                product_name = str(raw_name).strip()

        # 商品名がCSVにない場合、この時間帯は「不明な商品の売上」として記録
        if not product_name:
            continue

        # 商品リストとマッチング
        matched_name = None
        for pname, keywords in product_keywords.items():
            for kw in keywords:
                if kw in product_name.lower() or product_name.lower() in kw:
                    matched_name = pname
                    break
            if matched_name:
                break

        if not matched_name:
            # 完全一致を試す
            if product_name in product_keywords:
                matched_name = product_name

        if matched_name:
            # 売上発生の前後5分を商品紹介時間と推定
            exposures.append({
                "product_name": matched_name,
                "brand_name": "",
                "time_start": max(0, video_time - 300),  # 5分前
                "time_end": video_time + 60,               # 1分後
                "confidence": min(0.85, 0.65 + min(orders, 5) * 0.04),
                "audio_confirmed": False,
                "source": "sales",
            })

    logger.info("[PRODUCT-v3] Sales detection: found %d exposures", len(exposures))
    return exposures


# ═══════════════════════════════════════════════════════════
# PHASE 3: 空白時間帯のみ画像分析（最小限のAPI呼び出し）
# ═══════════════════════════════════════════════════════════
def find_uncovered_gaps(
    audio_exposures: list[dict],
    total_duration: float,
    min_gap: float = 120.0,  # 2分以上の空白のみ対象
) -> list[tuple[float, float]]:
    """
    音声検出でカバーされていない時間帯（空白）を見つける。
    min_gap秒以上の空白のみを返す。
    """
    if not audio_exposures:
        return [(0, total_duration)]

    # 全exposureの時間範囲をマージ
    sorted_exp = sorted(audio_exposures, key=lambda x: x["time_start"])
    merged = []
    for exp in sorted_exp:
        if merged and exp["time_start"] <= merged[-1][1] + 30:  # 30秒以内のギャップは無視
            merged[-1] = (merged[-1][0], max(merged[-1][1], exp["time_end"]))
        else:
            merged.append((exp["time_start"], exp["time_end"]))

    # 空白時間帯を計算
    gaps = []
    prev_end = 0
    for start, end in merged:
        if start - prev_end >= min_gap:
            gaps.append((prev_end, start))
        prev_end = end

    # 最後の空白
    if total_duration - prev_end >= min_gap:
        gaps.append((prev_end, total_duration))

    return gaps


def build_product_detection_prompt(product_list: list[dict]) -> str:
    """商品リストを含むシステムプロンプトを構築する（v2と同じ高品質プロンプト）"""
    product_names = []
    for i, p in enumerate(product_list):
        name = p.get("product_name", p.get("name", p.get("商品名", p.get("商品タイトル", f"Product_{i}"))))
        brand = p.get("brand_name", p.get("brand", p.get("ブランド名", p.get("ブランド", ""))))
        if brand:
            product_names.append(f"- {name} ({brand})")
        else:
            product_names.append(f"- {name}")

    product_list_str = "\n".join(product_names)

    prompt = f"""あなたはライブコマース動画の商品検出AIです。
以下は、このライブ配信で販売されている商品リストです：

{product_list_str}

このフレーム画像を分析して、**配信者が現在アクティブに紹介・説明している商品**を上記リストから特定してください。

【重要な判定基準 — 以下の状態の商品のみを検出してください】
- 配信者が手に持っている商品 → confidence: 0.85〜0.95
- 配信者がカメラに向けて見せている商品 → confidence: 0.80〜0.95
- 画面の中央に大きく映っている商品（クローズアップ） → confidence: 0.75〜0.90
- 配信者が指差している・触れている商品 → confidence: 0.70〜0.85

【除外すべきもの — 検出しないでください】
- 背景や棚に並んでいるだけの商品
- テーブルの上に置いてあるが、配信者が触れていない商品
- 画面の端に小さく映っているだけの商品
- 前の紹介で使った後、脇に置かれた商品
- 配信者の後ろに見える商品ディスプレイ

【判断のポイント】
- 配信者の手や腕の位置に注目する
- 商品が画面のどの位置にあるか（中央=紹介中の可能性高い、端=背景の可能性高い）
- 商品のサイズ（大きく映っている=紹介中、小さい=背景）
- 配信者の体の向き（商品に向いている=紹介中）

JSON形式で返してください：
{{
  "detected_products": [
    {{
      "product_name": "商品名（リストと完全一致）",
      "confidence": 0.0〜1.0,
      "detection_reason": "hand_holding|showing_camera|closeup|pointing|background_only"
    }}
  ]
}}

配信者が商品を紹介していない場合は空配列を返してください：
{{"detected_products": []}}"""
    return prompt


def detect_products_in_frame(image_path: str, prompt: str) -> list[dict]:
    """1フレームの商品検出（同期）"""
    img_b64 = encode_image(image_path)

    for attempt in range(5):
        try:
            resp = client.responses.create(
                model=GPT5_MODEL,
                input=[{
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {
                            "type": "input_image",
                            "image_url": f"data:image/jpeg;base64,{img_b64}",
                        },
                    ],
                }],
                max_output_tokens=512,
            )
            data = safe_json_load(resp.output_text)
            if data and "detected_products" in data:
                results = []
                for det in data["detected_products"]:
                    reason = det.get("detection_reason", "")
                    if reason == "background_only":
                        continue
                    results.append(det)
                return results
            return []
        except (RateLimitError, APITimeoutError):
            sleep_time = (2 ** attempt) + random.uniform(0, 1)
            logger.warning("[PRODUCT] Rate limit, retry in %.1fs (attempt %d)", sleep_time, attempt + 1)
            time.sleep(sleep_time)
        except (APIError, Exception) as e:
            logger.warning("[PRODUCT] API error on %s: %s", os.path.basename(image_path), e)
            return []
    return []


async def detect_products_in_frame_async(
    image_path: str,
    prompt: str,
    sem: asyncio.Semaphore,
) -> list[dict]:
    """1フレームの商品検出（非同期ラッパー）"""
    async with sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            partial(detect_products_in_frame, image_path, prompt),
        )


def detect_from_images_for_gaps(
    frame_dir: str,
    product_list: list[dict],
    gaps: list[tuple[float, float]],
    sample_interval: int = 30,  # v3: 空白時間帯は30秒間隔でサンプリング
    on_progress=None,
) -> list[dict]:
    """
    空白時間帯のみ画像分析を実行する。
    v2と同じ高品質プロンプトを使用するが、対象フレーム数を大幅に削減。
    """
    if not gaps:
        logger.info("[PRODUCT-v3] No gaps to analyze with images")
        return []

    files = sorted([f for f in os.listdir(frame_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if not files:
        return []

    # 空白時間帯のフレームインデックスを選択
    sample_indices = []
    for gap_start, gap_end in gaps:
        start_idx = max(0, int(gap_start))
        end_idx = min(len(files) - 1, int(gap_end))
        for idx in range(start_idx, end_idx + 1, sample_interval):
            if idx < len(files):
                sample_indices.append(idx)

    if not sample_indices:
        logger.info("[PRODUCT-v3] No frames to analyze in gaps")
        return []

    total_samples = len(sample_indices)
    logger.info(
        "[PRODUCT-v3] Image analysis for %d gaps: %d frames (interval=%ds)",
        len(gaps), total_samples, sample_interval,
    )

    prompt = build_product_detection_prompt(product_list)
    frame_detections: dict[int, list[dict]] = {}
    completed = [0]

    async def run_detection():
        sem = asyncio.Semaphore(MAX_CONCURRENCY)
        tasks = []

        for fidx in sample_indices:
            image_path = os.path.join(frame_dir, files[fidx])

            async def _detect(idx=fidx, path=image_path):
                result = await detect_products_in_frame_async(path, prompt, sem)
                frame_detections[idx] = result
                completed[0] += 1
                if on_progress and total_samples > 0:
                    pct = min(int(completed[0] / total_samples * 100), 100)
                    on_progress(pct)

            tasks.append(_detect())

        await asyncio.gather(*tasks)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pool.submit(asyncio.run, run_detection()).result()
        else:
            loop.run_until_complete(run_detection())
    except RuntimeError:
        asyncio.run(run_detection())

    logger.info(
        "[PRODUCT-v3] Image detection complete: %d frames, %d had products",
        len(frame_detections),
        sum(1 for v in frame_detections.values() if v),
    )

    # フレーム検出結果をexposureに変換
    return merge_image_detections(frame_detections, sample_interval)


def merge_image_detections(
    frame_detections: dict[int, list[dict]],
    sample_interval: int = 30,
    min_duration: float = 8.0,
    confidence_threshold: float = 0.5,
) -> list[dict]:
    """フレームごとの画像検出結果を統合してexposureセグメントを生成する。"""
    if not frame_detections:
        return []

    sorted_frames = sorted(frame_detections.keys())
    product_frames: dict[str, list[tuple[int, float]]] = {}

    for fidx in sorted_frames:
        for det in frame_detections[fidx]:
            name = det.get("product_name", "")
            conf = det.get("confidence", 0.5)
            reason = det.get("detection_reason", "")
            if reason == "background_only":
                continue
            if not name or conf < confidence_threshold:
                continue
            if name not in product_frames:
                product_frames[name] = []
            product_frames[name].append((fidx, conf))

    exposures = []
    for product_name, frames in product_frames.items():
        if not frames:
            continue

        frames.sort(key=lambda x: x[0])
        gap_tolerance = sample_interval * 2 + 1
        segments = []
        seg_start = frames[0][0]
        seg_end = frames[0][0]
        seg_confs = [frames[0][1]]

        for i in range(1, len(frames)):
            fidx, conf = frames[i]
            if fidx - seg_end <= gap_tolerance:
                seg_end = fidx
                seg_confs.append(conf)
            else:
                segments.append((seg_start, seg_end, seg_confs))
                seg_start = fidx
                seg_end = fidx
                seg_confs = [conf]

        segments.append((seg_start, seg_end, seg_confs))

        for start_frame, end_frame, confs in segments:
            time_start = float(start_frame)
            time_end = float(end_frame + sample_interval)
            duration = time_end - time_start

            if duration < min_duration:
                continue

            avg_conf = sum(confs) / len(confs)
            exposures.append({
                "product_name": product_name,
                "brand_name": "",
                "time_start": time_start,
                "time_end": time_end,
                "confidence": round(avg_conf, 2),
                "audio_confirmed": False,
                "source": "image",
            })

    exposures.sort(key=lambda x: x["time_start"])
    return exposures


# ═══════════════════════════════════════════════════════════
# PHASE 4: 統合・フィルタ・補完
# ═══════════════════════════════════════════════════════════
def merge_all_exposures(
    audio_exposures: list[dict],
    sales_exposures: list[dict],
    image_exposures: list[dict],
) -> list[dict]:
    """
    3つのソースからのexposureを統合する。
    同じ商品の重複する時間帯はマージする。
    """
    all_exposures = audio_exposures + sales_exposures + image_exposures

    if not all_exposures:
        return []

    # 商品ごとにグループ化
    by_product: dict[str, list[dict]] = {}
    for exp in all_exposures:
        name = exp["product_name"]
        if name not in by_product:
            by_product[name] = []
        by_product[name].append(exp)

    merged = []
    for product_name, exps in by_product.items():
        exps.sort(key=lambda x: x["time_start"])

        # 重複する時間帯をマージ
        current = exps[0].copy()
        for i in range(1, len(exps)):
            next_exp = exps[i]
            # 重複チェック（30秒以内のギャップはマージ）
            if next_exp["time_start"] <= current["time_end"] + 30:
                # マージ
                current["time_end"] = max(current["time_end"], next_exp["time_end"])
                # confidenceは高い方を採用
                current["confidence"] = max(current["confidence"], next_exp["confidence"])
                # audio_confirmedは一つでもTrueならTrue
                if next_exp.get("audio_confirmed"):
                    current["audio_confirmed"] = True
                # sourceを統合
                sources = set()
                if current.get("source"):
                    sources.add(current["source"])
                if next_exp.get("source"):
                    sources.add(next_exp["source"])
                current["source"] = "+".join(sorted(sources))
            else:
                merged.append(current)
                current = next_exp.copy()

        merged.append(current)

    merged.sort(key=lambda x: x["time_start"])
    return merged


def post_filter_exposures(
    exposures: list[dict],
    final_confidence_threshold: float = 0.45,
    min_final_duration: float = 8.0,
) -> list[dict]:
    """最終フィルタ（v2と同じロジック）"""
    filtered = []
    removed = []
    for exp in exposures:
        duration = exp["time_end"] - exp["time_start"]
        conf = exp.get("confidence", 0)

        if exp.get("audio_confirmed"):
            if conf >= 0.40 and duration >= 5.0:
                filtered.append(exp)
            else:
                removed.append(exp)
        else:
            if conf >= final_confidence_threshold and duration >= min_final_duration:
                filtered.append(exp)
            else:
                removed.append(exp)

    if removed:
        logger.info(
            "[PRODUCT-v3] Post-filter removed %d segments (kept %d)",
            len(removed), len(filtered),
        )

    return filtered


def fill_brand_names(exposures: list[dict], product_list: list[dict]) -> list[dict]:
    """product_listからbrand_nameとimage_urlを補完する"""
    name_to_info: dict[str, dict] = {}
    for p in product_list:
        name = p.get("product_name", p.get("name", p.get("商品名", p.get("商品タイトル", ""))))
        if name:
            name_to_info[name] = {
                "brand_name": p.get("brand_name", p.get("brand", p.get("ブランド名", p.get("ブランド", "")))),
                "image_url": p.get("image_url", p.get("product_image_url", "")),
            }

    for exp in exposures:
        info = name_to_info.get(exp["product_name"], {})
        exp["brand_name"] = info.get("brand_name", "")
        exp["product_image_url"] = info.get("image_url", "")

    return exposures


# ═══════════════════════════════════════════════════════════
# MAIN ENTRY POINT (v3)
# ═══════════════════════════════════════════════════════════
def detect_product_timeline(
    frame_dir: str,
    product_list: list[dict],
    transcription_segments: list[dict] | None = None,
    sample_interval: int = 5,  # 互換性のため残すが、v3では内部で最適化
    on_progress=None,
    excel_data: dict | None = None,
    time_offset_seconds: float = 0,
) -> list[dict]:
    """
    商品タイムライン検出のメインエントリポイント (v3)。

    v3アーキテクチャ:
      1. 音声トランスクリプトから商品言及を検出（0秒、API不要）
      2. 売上データから商品露出を推定（0秒、API不要）
      3. 空白時間帯のみ画像分析（少数のAPI呼び出し）
      4. 全結果を統合・フィルタ

    Args:
        frame_dir: フレーム画像のディレクトリ
        product_list: 商品リスト
        transcription_segments: Whisper文字起こし結果
        sample_interval: (v3では内部最適化のため参考値)
        on_progress: 進捗コールバック (0-100)
        excel_data: Excelから読み込んだ売上データ
        time_offset_seconds: 動画の時間オフセット

    Returns:
        exposures: [{"product_name", "brand_name", "time_start", "time_end",
                     "confidence", "product_image_url"}]
    """
    if not product_list:
        logger.warning("[PRODUCT-v3] No product list provided, skipping detection")
        return []

    files = sorted([f for f in os.listdir(frame_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if not files:
        logger.warning("[PRODUCT-v3] No frames found in %s", frame_dir)
        return []

    total_duration = float(len(files))  # fps=1なのでフレーム数=秒数

    logger.info(
        "[PRODUCT-v3] Starting detection: %d frames (%.0f sec), %d products",
        len(files), total_duration, len(product_list),
    )

    # キーワードマップを構築
    product_keywords = build_product_keyword_map(product_list)

    # ── PHASE 1: 音声検出（即座、API不要）──
    t0 = time.time()
    audio_exposures = []
    if transcription_segments:
        audio_exposures = detect_from_transcription(
            transcription_segments, product_keywords,
        )
    logger.info("[PRODUCT-v3] Phase 1 (audio): %d exposures in %.1fs", len(audio_exposures), time.time() - t0)

    if on_progress:
        on_progress(30)

    # ── PHASE 2: 売上データ検出（即座、API不要）──
    t1 = time.time()
    sales_exposures = detect_from_sales_data(
        excel_data, product_keywords, time_offset_seconds,
    )
    logger.info("[PRODUCT-v3] Phase 2 (sales): %d exposures in %.1fs", len(sales_exposures), time.time() - t1)

    if on_progress:
        on_progress(50)

    # ── PHASE 3: 空白時間帯の画像分析（最小限のAPI呼び出し）──
    t2 = time.time()
    all_known = audio_exposures + sales_exposures
    gaps = find_uncovered_gaps(all_known, total_duration, min_gap=120.0)

    image_exposures = []
    if gaps:
        total_gap_duration = sum(end - start for start, end in gaps)
        logger.info(
            "[PRODUCT-v3] Phase 3: %d gaps (total %.0f sec), analyzing with images",
            len(gaps), total_gap_duration,
        )

        def _on_image_progress(pct):
            if on_progress:
                # 50-90%の範囲でマッピング
                on_progress(50 + int(pct * 0.4))

        image_exposures = detect_from_images_for_gaps(
            frame_dir=frame_dir,
            product_list=product_list,
            gaps=gaps,
            sample_interval=30,  # 空白時間帯は30秒間隔
            on_progress=_on_image_progress,
        )
    else:
        logger.info("[PRODUCT-v3] Phase 3: No significant gaps, skipping image analysis")

    logger.info("[PRODUCT-v3] Phase 3 (image): %d exposures in %.1fs", len(image_exposures), time.time() - t2)

    if on_progress:
        on_progress(90)

    # ── PHASE 4: 統合・フィルタ ──
    exposures = merge_all_exposures(audio_exposures, sales_exposures, image_exposures)
    logger.info("[PRODUCT-v3] After merge: %d exposures", len(exposures))

    exposures = post_filter_exposures(exposures)
    logger.info("[PRODUCT-v3] After post-filter: %d exposures", len(exposures))

    exposures = fill_brand_names(exposures, product_list)

    if on_progress:
        on_progress(100)

    # サマリーログ
    total_time = time.time() - t0
    logger.info(
        "[PRODUCT-v3] COMPLETE: %d exposures (audio=%d, sales=%d, image=%d), "
        "total time=%.1fs (v2 would have taken ~%d min)",
        len(exposures),
        len(audio_exposures), len(sales_exposures), len(image_exposures),
        total_time,
        int(total_duration / 5) // 60,
    )

    return exposures

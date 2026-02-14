"""
RAG Prompt Builder for aitherhub RAG system (v2 - Extended).

Constructs augmented prompts by combining retrieved past analysis examples
with the current video data. Now includes sales performance data and
screen recording metrics for data-driven insights.

v2 Extensions:
- Sales data integration in prompts
- Screen recording metrics in prompts
- Liver history comparison prompts
- Top performer reference prompts
"""

import logging
from typing import Dict, List

logger = logging.getLogger("rag_prompt_builder")


def build_rag_phase_label_prompt(
    current_visual_context: str,
    current_speech_text: str,
    similar_analyses: List[Dict],
) -> str:
    """
    Build a RAG-augmented prompt for phase labeling.
    Includes sales context from similar past analyses when available.
    """
    prompt_parts = []

    if similar_analyses:
        prompt_parts.append(
            "以下は、過去の類似したライブ配信フェーズの分析例です。"
            "これらを参考にして、より正確な分析を行ってください。\n"
        )
        for i, example in enumerate(similar_analyses[:3], 1):
            prompt_parts.append(f"--- 参考例 {i} ---")
            if example.get("speech_text"):
                prompt_parts.append(f"発話内容: {example['speech_text'][:200]}")
            if example.get("visual_context"):
                prompt_parts.append(f"映像内容: {example['visual_context'][:200]}")
            prompt_parts.append(f"分析結果: {example.get('behavior_label', '')}")
            if example.get("ai_insight"):
                prompt_parts.append(f"洞察: {example['ai_insight'][:200]}")
            # v2: Include sales context if available
            sales = example.get("sales_data", {})
            if sales.get("gmv"):
                prompt_parts.append(
                    f"配信実績: GMV ¥{sales['gmv']:,.0f}, "
                    f"注文数 {sales.get('total_orders', 'N/A')}, "
                    f"CVR {sales.get('cvr', 'N/A')}%"
                )
            prompt_parts.append("")

        prompt_parts.append("--- 以上が参考例です ---\n")

    prompt_parts.append("あなたはライブ配信のフェーズを分析しています。")
    prompt_parts.append("")
    prompt_parts.append("以下の情報に基づいて:")
    prompt_parts.append(f"  - 映像コンテキスト: {current_visual_context}")
    prompt_parts.append(f"  - 音声書き起こし: {current_speech_text}")
    prompt_parts.append("")
    prompt_parts.append("以下のいずれかのラベルを付与してください:")
    prompt_parts.append("  - product_demo（商品デモ）")
    prompt_parts.append("  - price_explanation（価格説明）")
    prompt_parts.append("  - call_to_action（購入促進）")
    prompt_parts.append("  - qna（質問回答）")
    prompt_parts.append("  - idle（待機）")

    return "\n".join(prompt_parts)


def build_rag_insight_prompt(
    labeled_phases: List[Dict],
    similar_insights: List[Dict],
    current_sales_data: Dict = None,
    current_screen_metrics: Dict = None,
) -> str:
    """
    Build a RAG-augmented prompt for cross-phase insight generation.

    Now includes sales performance comparison between current stream
    and past high-performing streams.
    """
    prompt_parts = []

    # Add RAG context with sales data
    if similar_insights:
        prompt_parts.append(
            "以下は、過去の類似した配信に対する優れた分析洞察です。"
            "売上データも含まれています。これらを参考にしてください。\n"
        )
        for i, example in enumerate(similar_insights[:3], 1):
            prompt_parts.append(f"--- 過去の優れた洞察 {i} ---")
            prompt_parts.append(f"{example.get('ai_insight', '')[:500]}")
            # v2: Include sales data from past examples
            sales = example.get("sales_data", {})
            if sales.get("gmv"):
                prompt_parts.append(
                    f"この配信の実績: GMV ¥{sales['gmv']:,.0f}, "
                    f"注文数 {sales.get('total_orders', 'N/A')}, "
                    f"CVR {sales.get('cvr', 'N/A')}%, "
                    f"視聴者数 {sales.get('viewers', 'N/A')}"
                )
            screen = example.get("screen_metrics", {})
            if screen.get("viewer_count"):
                prompt_parts.append(
                    f"画面収録データ: 視聴者 {screen['viewer_count']}, "
                    f"いいね {screen.get('likes', 'N/A')}"
                )
            prompt_parts.append("")

        prompt_parts.append("--- 以上が参考です ---\n")

    # Add current stream's sales data
    if current_sales_data:
        prompt_parts.append("【今回の配信の売上データ】")
        _append_sales_data(prompt_parts, current_sales_data)
        prompt_parts.append("")

    # Add current screen recording metrics
    if current_screen_metrics:
        prompt_parts.append("【今回の配信の画面収録データ】")
        _append_screen_metrics(prompt_parts, current_screen_metrics)
        prompt_parts.append("")

    # Add the current analysis target
    prompt_parts.append(
        "複数のラベル付きライブ配信フェーズが与えられています。\n"
    )
    prompt_parts.append("フェーズ間のパターンを分析し、以下を返してください:")
    prompt_parts.append("  - 繰り返し行動（Repeated behaviors）")
    prompt_parts.append("  - 効果的な手法（What works better）")
    prompt_parts.append("  - 全体的な洞察（High-level insight）")
    if current_sales_data or current_screen_metrics:
        prompt_parts.append("  - 売上との相関分析（Sales correlation analysis）")
        prompt_parts.append("  - 具体的な改善提案（Specific improvement suggestions）")
    prompt_parts.append("")

    for p in labeled_phases:
        label = p.get("behavior_label", "unknown")
        speech = p.get("speech_text", "")[:100]
        prompt_parts.append(f"- {label}: {speech}")

    return "\n".join(prompt_parts)


def build_rag_report_prompt(
    current_data: Dict,
    similar_reports: List[Dict],
    current_sales_data: Dict = None,
    current_set_products: List[Dict] = None,
    current_screen_metrics: Dict = None,
    liver_history: List[Dict] = None,
    top_performers: List[Dict] = None,
) -> str:
    """
    Build a RAG-augmented prompt for report generation.

    v2: Comprehensive prompt that includes:
    - Past similar reports as reference
    - Current stream's sales data
    - Product bundle performance
    - Liver's historical performance for trend analysis
    - Top performer benchmarks
    """
    prompt_parts = []

    # Past similar reports
    if similar_reports:
        prompt_parts.append(
            "以下は、過去の類似した配信に対する高品質な分析レポートの例です。"
            "これらのレポートの構成、深さ、具体性を参考にしてください。\n"
        )
        for i, report in enumerate(similar_reports[:2], 1):
            prompt_parts.append(f"--- 参考レポート {i} ---")
            prompt_parts.append(f"{report.get('ai_insight', '')[:1000]}")
            sales = report.get("sales_data", {})
            if sales.get("gmv"):
                prompt_parts.append(
                    f"配信実績: GMV ¥{sales['gmv']:,.0f}, "
                    f"CVR {sales.get('cvr', 'N/A')}%"
                )
            prompt_parts.append("")
        prompt_parts.append("--- 以上が参考です ---\n")

    # Top performers as benchmark
    if top_performers:
        prompt_parts.append("【トップパフォーマー（ベンチマーク）】")
        for i, tp in enumerate(top_performers[:3], 1):
            sales = tp.get("sales_data", {})
            prompt_parts.append(
                f"  {i}. GMV ¥{sales.get('gmv', 0):,.0f} | "
                f"CVR {sales.get('cvr', 'N/A')}% | "
                f"注文数 {sales.get('total_orders', 'N/A')} | "
                f"ライバー: {tp.get('liver_name', 'N/A')}"
            )
            if tp.get("ai_insight"):
                prompt_parts.append(f"     成功要因: {tp['ai_insight'][:200]}")
        prompt_parts.append("")

    # Liver history for trend analysis
    if liver_history:
        prompt_parts.append("【このライバーの過去の配信履歴】")
        for i, h in enumerate(liver_history[:5], 1):
            sales = h.get("sales_data", {})
            gmv = sales.get("gmv", 0)
            date = h.get("stream_date", h.get("created_at", "N/A"))
            prompt_parts.append(
                f"  {i}. {date} | GMV ¥{gmv:,.0f} | "
                f"CVR {sales.get('cvr', 'N/A')}%"
            )
            if h.get("ai_insight"):
                prompt_parts.append(f"     分析: {h['ai_insight'][:150]}")
        prompt_parts.append("")

    # Current stream's sales data (Pattern A)
    if current_sales_data:
        prompt_parts.append("【今回の配信の売上データ（TikTokダッシュボード）】")
        _append_sales_data(prompt_parts, current_sales_data)
        prompt_parts.append("")

    # Current set products (Pattern A)
    if current_set_products:
        prompt_parts.append("【今回のセット商品の販売実績】")
        total_set_revenue = 0
        for sp in current_set_products:
            name = sp.get("name", "")
            price = sp.get("price", 0)
            qty = sp.get("quantity_sold", 0)
            rev = sp.get("set_revenue", 0)
            discount = sp.get("discount_rate", 0)
            items = sp.get("items", [])
            total_set_revenue += rev
            prompt_parts.append(
                f"  {name}: ¥{price:,.0f} × {qty}セット = ¥{rev:,.0f} "
                f"({discount}%OFF)"
            )
            if items:
                prompt_parts.append(f"    内容: {', '.join(items[:5])}")
        prompt_parts.append(f"  セット合計: ¥{total_set_revenue:,.0f}")
        prompt_parts.append("")

    # Current screen recording metrics (Pattern B)
    if current_screen_metrics:
        prompt_parts.append("【今回の配信の画面収録データ】")
        _append_screen_metrics(prompt_parts, current_screen_metrics)
        prompt_parts.append("")

    # Instructions
    prompt_parts.append(
        "上記の全データを踏まえ、以下の配信データに基づいて"
        "詳細な分析レポートを生成してください。\n"
    )
    prompt_parts.append("レポートには以下を含めてください:")
    prompt_parts.append("  1. 配信の総合評価")
    prompt_parts.append("  2. フェーズ構成の分析")
    prompt_parts.append("  3. トーク内容の評価")

    if current_sales_data or current_screen_metrics:
        prompt_parts.append("  4. 売上パフォーマンス分析")
        prompt_parts.append("     - GMV、CVR、注文数の評価")
        prompt_parts.append("     - トップパフォーマーとの比較")
        prompt_parts.append("  5. セット商品の販売分析（該当する場合）")
        prompt_parts.append("     - どのセットが売れたか、なぜ売れたか")
        prompt_parts.append("  6. 具体的な改善提案")
        prompt_parts.append("     - 数値に基づいた具体的なアクション")
        prompt_parts.append("     - 過去の成功パターンとの比較")

    if liver_history:
        prompt_parts.append("  7. 成長トレンド分析")
        prompt_parts.append("     - 過去の配信との比較")
        prompt_parts.append("     - 改善された点と悪化した点")

    return "\n".join(prompt_parts)


def _append_sales_data(parts: List[str], sales_data: Dict):
    """Append formatted sales data to prompt parts."""
    if sales_data.get("gmv"):
        parts.append(f"  GMV（総売上）: ¥{sales_data['gmv']:,.0f}")
    if sales_data.get("total_orders"):
        parts.append(f"  注文数: {sales_data['total_orders']}")
    if sales_data.get("product_sales_count"):
        parts.append(f"  商品販売数: {sales_data['product_sales_count']}")
    if sales_data.get("viewers"):
        parts.append(f"  視聴者数: {sales_data['viewers']:,.0f}")
    if sales_data.get("impressions"):
        parts.append(f"  インプレッション: {sales_data['impressions']:,.0f}")
    if sales_data.get("product_impressions"):
        parts.append(f"  商品インプレッション: {sales_data['product_impressions']:,.0f}")
    if sales_data.get("product_clicks"):
        parts.append(f"  商品クリック数: {sales_data['product_clicks']:,.0f}")
    if sales_data.get("live_ctr"):
        parts.append(f"  LIVE CTR: {sales_data['live_ctr']}%")
    if sales_data.get("cvr"):
        parts.append(f"  CVR（転換率）: {sales_data['cvr']}%")
    if sales_data.get("tap_through_rate"):
        parts.append(f"  タップスルー率: {sales_data['tap_through_rate']}%")
    if sales_data.get("comment_rate"):
        parts.append(f"  コメント率: {sales_data['comment_rate']}%")
    if sales_data.get("avg_gpm"):
        parts.append(f"  時間あたりGMV: ¥{sales_data['avg_gpm']:,.0f}")
    if sales_data.get("duration_minutes"):
        parts.append(f"  配信時間: {sales_data['duration_minutes']}分")
    # Traffic source data
    if sales_data.get("traffic_sources"):
        parts.append("  トラフィックソース:")
        for src in sales_data["traffic_sources"]:
            parts.append(
                f"    {src.get('channel', '')}: "
                f"GMV {src.get('gmv_pct', '')}%, "
                f"インプレ {src.get('impression_pct', '')}%, "
                f"視聴 {src.get('viewer_pct', '')}%"
            )
    # Follower analysis
    if sales_data.get("follower_ratio"):
        parts.append(
            f"  フォロワー率: {sales_data['follower_ratio']}% / "
            f"非フォロワー: {100 - sales_data['follower_ratio']}%"
        )


def _append_screen_metrics(parts: List[str], screen_metrics: Dict):
    """Append formatted screen recording metrics to prompt parts."""
    if screen_metrics.get("viewer_count"):
        parts.append(f"  リアルタイム視聴者数: {screen_metrics['viewer_count']}")
    if screen_metrics.get("likes"):
        parts.append(f"  いいね数: {screen_metrics['likes']}")
    if screen_metrics.get("hearts"):
        parts.append(f"  ハート数: {screen_metrics['hearts']}")
    if screen_metrics.get("shopping_rank"):
        parts.append(f"  ショッピングランキング: No.{screen_metrics['shopping_rank']}")
    if screen_metrics.get("product_browsing"):
        parts.append(f"  商品閲覧状況: {screen_metrics['product_browsing']}")
    if screen_metrics.get("purchase_notifications"):
        notifs = screen_metrics["purchase_notifications"]
        parts.append(f"  購入通知数: {len(notifs)}")
        for n in notifs[:5]:
            parts.append(f"    {n}")
    if screen_metrics.get("comments"):
        comments = screen_metrics["comments"]
        parts.append(f"  コメント数: {len(comments)}")
        for c in comments[:5]:
            parts.append(f"    「{c}」")
    if screen_metrics.get("viewer_trend"):
        parts.append(f"  視聴者推移: {screen_metrics['viewer_trend']}")
    if screen_metrics.get("guest_invitations"):
        parts.append(f"  ゲスト招待: {screen_metrics['guest_invitations']}")

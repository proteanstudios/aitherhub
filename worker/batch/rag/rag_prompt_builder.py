"""
RAG Prompt Builder for aitherhub RAG system.

Constructs augmented prompts by combining retrieved past analysis examples
with the current video data. This is the core mechanism that enables the
system to "learn" from past analyses.
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

    Enhances the base PHASE_LABEL_PROMPT by prepending relevant past
    analysis examples. The LLM can reference these examples to produce
    more accurate and consistent phase labels.
    """
    prompt_parts = []

    # Add RAG context if available
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
            prompt_parts.append("")

        prompt_parts.append("--- 以上が参考例です ---\n")

    # Add the current analysis target
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
) -> str:
    """
    Build a RAG-augmented prompt for cross-phase insight generation.

    Enhances the base INSIGHT_PROMPT by including past high-quality
    insights as reference. This helps the LLM generate more actionable
    and specific insights based on proven analysis patterns.
    """
    prompt_parts = []

    # Add RAG context if available
    if similar_insights:
        prompt_parts.append(
            "以下は、過去の類似した配信に対する優れた分析洞察です。"
            "これらの分析品質と深さを参考にしてください。\n"
        )
        for i, example in enumerate(similar_insights[:3], 1):
            prompt_parts.append(f"--- 過去の優れた洞察 {i} ---")
            prompt_parts.append(f"{example.get('ai_insight', '')[:500]}")
            prompt_parts.append("")

        prompt_parts.append("--- 以上が参考です ---\n")

    # Add the current analysis target
    prompt_parts.append(
        "複数のラベル付きライブ配信フェーズが与えられています。\n"
    )
    prompt_parts.append("フェーズ間のパターンを分析し、以下を返してください:")
    prompt_parts.append("  - 繰り返し行動（Repeated behaviors）")
    prompt_parts.append("  - 効果的な手法（What works better）")
    prompt_parts.append("  - 全体的な洞察（High-level insight）")
    prompt_parts.append("")

    # Add current phases
    for p in labeled_phases:
        label = p.get("behavior_label", "unknown")
        speech = p.get("speech_text", "")[:100]
        prompt_parts.append(f"- {label}: {speech}")

    return "\n".join(prompt_parts)


def build_rag_report_prompt(
    current_data: Dict,
    similar_reports: List[Dict],
) -> str:
    """
    Build a RAG-augmented prompt for report generation.

    Provides the report generation LLM with examples of past
    high-quality reports, enabling it to produce more comprehensive
    and actionable analysis reports.
    """
    prompt_parts = []

    if similar_reports:
        prompt_parts.append(
            "以下は、過去の類似した配信に対する高品質な分析レポートの例です。"
            "これらのレポートの構成、深さ、具体性を参考にしてください。\n"
        )
        for i, report in enumerate(similar_reports[:2], 1):
            prompt_parts.append(f"--- 参考レポート {i} ---")
            prompt_parts.append(f"{report.get('ai_insight', '')[:1000]}")
            prompt_parts.append("")

        prompt_parts.append("--- 以上が参考です ---\n")

    prompt_parts.append(
        "上記の参考を踏まえ、以下の配信データに基づいて"
        "詳細な分析レポートを生成してください。\n"
    )

    return "\n".join(prompt_parts)

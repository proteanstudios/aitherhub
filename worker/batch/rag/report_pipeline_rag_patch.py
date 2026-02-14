"""
RAG Patch for report_pipeline.py

This file shows the modifications needed to integrate RAG context
into the existing report generation pipeline. The key change is
modifying rewrite_report_2_with_gpt to accept and use RAG context.

Apply these changes to: worker/batch/report_pipeline.py
"""


# ============================================================
# MODIFICATION 1: Update rewrite_report_2_with_gpt signature
# ============================================================

def rewrite_report_2_with_gpt(
    report_2_raw: str,
    rag_context: dict = None,  # NEW PARAMETER
) -> str:
    """
    Rewrite the raw phase insights report using GPT, enhanced with RAG context.

    When rag_context is provided, the prompt includes relevant past
    analysis examples, enabling the LLM to produce higher-quality
    insights based on proven analysis patterns.

    Args:
        report_2_raw: Raw phase insights report text
        rag_context: Optional dictionary containing:
            - phase_examples: Dict[int, List[Dict]] - similar analyses per phase
            - overall_insights: List[Dict] - overall similar insights

    Returns:
        Rewritten report with enhanced insights
    """
    from rag.rag_prompt_builder import build_rag_report_prompt

    # Build the base system prompt
    system_prompt = (
        "あなたはライブ配信の分析エキスパートです。"
        "配信者のパフォーマンスを分析し、具体的で実用的なアドバイスを提供します。"
    )

    # Build the user prompt with RAG augmentation
    user_prompt_parts = []

    # Add RAG context if available
    if rag_context and rag_context.get("overall_insights"):
        rag_section = build_rag_report_prompt(
            current_data={"report": report_2_raw},
            similar_reports=rag_context["overall_insights"],
        )
        user_prompt_parts.append(rag_section)

    # Add the current report data
    user_prompt_parts.append(
        "以下のライブ配信分析データを、読みやすく実用的なレポートに書き直してください。\n"
    )
    user_prompt_parts.append(report_2_raw)

    user_prompt = "\n".join(user_prompt_parts)

    # Call GPT (using existing Azure OpenAI client)
    # ... existing GPT call logic ...
    # response = client.chat.completions.create(
    #     model=GPT_MODEL,
    #     messages=[
    #         {"role": "system", "content": system_prompt},
    #         {"role": "user", "content": user_prompt},
    #     ],
    # )
    # return response.choices[0].message.content

    pass  # Placeholder - integrate with existing GPT call


# ============================================================
# MODIFICATION 2: Update build_report_2_phase_insights_raw
# ============================================================

def build_report_2_phase_insights_raw_with_rag(
    phases: list,
    rag_context: dict = None,
) -> str:
    """
    Build raw phase insights report, enhanced with RAG examples.

    When RAG context is available, each phase's analysis is augmented
    with relevant past examples, improving the quality and consistency
    of phase-level insights.
    """
    from rag.rag_prompt_builder import build_rag_phase_label_prompt

    report_lines = []

    for i, phase in enumerate(phases):
        phase_type = phase.get("behavior_label", "unknown")
        speech = phase.get("speech_text", "")
        visual = phase.get("visual_context", "")

        # Check if RAG examples exist for this phase
        phase_examples = []
        if rag_context and rag_context.get("phase_examples"):
            phase_examples = rag_context["phase_examples"].get(i, [])

        if phase_examples:
            # Use RAG-augmented prompt for this phase
            augmented_prompt = build_rag_phase_label_prompt(
                current_visual_context=visual,
                current_speech_text=speech,
                similar_analyses=phase_examples,
            )
            report_lines.append(f"## Phase {i}: {phase_type}")
            report_lines.append(f"(RAG参照: {len(phase_examples)}件の類似分析)")
            # ... use augmented_prompt for LLM call ...
        else:
            report_lines.append(f"## Phase {i}: {phase_type}")

        report_lines.append(f"Speech: {speech[:200]}")
        report_lines.append(f"Visual: {visual[:200]}")
        report_lines.append("")

    return "\n".join(report_lines)

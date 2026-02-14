"""
RAG Integration for process_video.py

This file contains the code additions needed to integrate RAG into
the existing video processing pipeline. These changes should be
applied to worker/batch/process_video.py.

Two new steps are added to the pipeline:
  1. RAG_RETRIEVE: Before report generation, retrieve similar past analyses
  2. RAG_STORE: After report generation, store results in knowledge base
"""

# ============================================================
# ADDITION 1: New imports (add to top of process_video.py)
# ============================================================

# --- Add these imports after existing imports ---
from rag.rag_client import get_qdrant_client, init_collection
from rag.knowledge_retriever import retrieve_similar_analyses
from rag.knowledge_store import store_video_analysis
from rag.rag_prompt_builder import (
    build_rag_insight_prompt,
    build_rag_report_prompt,
)

# ============================================================
# ADDITION 2: New VideoStatus steps
# Add to worker/batch/video_status.py
# ============================================================

# Add these to the VideoStatus enum:
# STEP_RAG_RETRIEVE = "rag_retrieve"
# STEP_RAG_STORE = "rag_store"


# ============================================================
# ADDITION 3: RAG retrieve function
# Add to process_video.py
# ============================================================

def step_rag_retrieve(video_id: str, phases: list, user_email: str) -> dict:
    """
    RAG Retrieve Step: Search knowledge base for similar past analyses.

    This step runs before report generation. It searches the Qdrant
    knowledge base for past analyses that are similar to the current
    video's phases. The retrieved examples are passed to the report
    generation step to augment the LLM prompt.

    Args:
        video_id: Current video ID
        phases: List of phase dictionaries with speech_text, visual_context, etc.
        user_email: Email of the user who uploaded the video

    Returns:
        Dictionary containing retrieved similar analyses for each phase
        and overall similar insights.
    """
    logger.info(f"[RAG] Starting knowledge retrieval for video={video_id}")

    try:
        client = get_qdrant_client()
        init_collection(client)
    except Exception as e:
        logger.warning(f"[RAG] Qdrant not available, skipping RAG: {e}")
        return {"phase_examples": {}, "overall_insights": []}

    rag_context = {
        "phase_examples": {},
        "overall_insights": [],
    }

    # Retrieve similar analyses for each phase
    for i, phase in enumerate(phases):
        speech_text = phase.get("speech_text", "")
        visual_context = phase.get("visual_context", "")
        phase_type = phase.get("behavior_label", "")

        if not speech_text and not visual_context:
            continue

        try:
            similar = retrieve_similar_analyses(
                speech_text=speech_text,
                visual_context=visual_context,
                phase_type=phase_type,
                top_k=3,
                min_quality_score=0.0,
                exclude_video_id=video_id,
                client=client,
            )
            if similar:
                rag_context["phase_examples"][i] = similar
                logger.info(
                    f"[RAG] Phase {i} ({phase_type}): "
                    f"found {len(similar)} similar analyses"
                )
        except Exception as e:
            logger.warning(f"[RAG] Failed to retrieve for phase {i}: {e}")

    # Retrieve overall high-quality insights
    try:
        # Use the first phase's content as a general query
        if phases:
            first_phase = phases[0]
            overall_similar = retrieve_similar_analyses(
                speech_text=first_phase.get("speech_text", ""),
                visual_context=first_phase.get("visual_context", ""),
                top_k=5,
                min_quality_score=0.3,
                exclude_video_id=video_id,
                client=client,
            )
            rag_context["overall_insights"] = overall_similar
    except Exception as e:
        logger.warning(f"[RAG] Failed to retrieve overall insights: {e}")

    total_examples = sum(
        len(v) for v in rag_context["phase_examples"].values()
    )
    logger.info(
        f"[RAG] Retrieved {total_examples} phase examples and "
        f"{len(rag_context['overall_insights'])} overall insights"
    )

    return rag_context


# ============================================================
# ADDITION 4: RAG store function
# Add to process_video.py
# ============================================================

def step_rag_store(
    video_id: str,
    phases: list,
    user_email: str,
    filename: str = "",
    total_duration: float = 0.0,
):
    """
    RAG Store Step: Save analysis results to the knowledge base.

    This step runs after report generation. It stores each phase's
    analysis results (speech text, visual context, AI insights) into
    the Qdrant vector database for future retrieval.

    Args:
        video_id: Current video ID
        phases: List of phase dictionaries with complete analysis results
        user_email: Email of the user who uploaded the video
        filename: Original filename of the video
        total_duration: Total duration of the video in seconds
    """
    logger.info(f"[RAG] Storing analysis results for video={video_id}")

    try:
        point_ids = store_video_analysis(
            video_id=video_id,
            phases=phases,
            user_email=user_email,
            filename=filename,
            total_duration=total_duration,
        )
        logger.info(
            f"[RAG] Successfully stored {len(point_ids)} phases "
            f"for video={video_id}"
        )
    except Exception as e:
        logger.error(f"[RAG] Failed to store analysis: {e}")
        # Non-fatal: don't fail the pipeline if RAG storage fails


# ============================================================
# ADDITION 5: Modified pipeline flow
# Modify the main processing function in process_video.py
# ============================================================

"""
In the main processing function (e.g., process_video or run_pipeline),
add the following steps:

BEFORE the report generation step (build_report_2_phase_insights_raw):
    
    # --- RAG Retrieve ---
    rag_context = step_rag_retrieve(
        video_id=video_id,
        phases=phase_units,  # or whatever variable holds the phase data
        user_email=user_email,
    )
    
    # Pass rag_context to report generation
    # Modify rewrite_report_2_with_gpt to accept rag_context parameter

AFTER the report generation step (save_reports):

    # --- RAG Store ---
    step_rag_store(
        video_id=video_id,
        phases=phase_units_with_insights,  # phases with AI insights
        user_email=user_email,
        filename=filename,
        total_duration=total_duration,
    )
"""


# ============================================================
# ADDITION 6: STEP_ORDER update
# ============================================================

"""
Update STEP_ORDER in process_video.py to include RAG steps:

STEP_ORDER = [
    VideoStatus.STEP_0_EXTRACT_FRAMES,
    VideoStatus.STEP_1_DETECT_PHASES,
    VideoStatus.STEP_2_EXTRACT_METRICS,
    VideoStatus.STEP_3_TRANSCRIBE_AUDIO,
    VideoStatus.STEP_4_IMAGE_CAPTION,
    VideoStatus.STEP_5_BUILD_PHASE_UNITS,
    # ... existing steps ...
    VideoStatus.STEP_RAG_RETRIEVE,    # NEW: Retrieve past analyses
    # ... report generation steps ...
    VideoStatus.STEP_RAG_STORE,       # NEW: Store current analysis
]
"""

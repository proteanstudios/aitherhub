"""
Knowledge Store for aitherhub RAG system.

Stores video analysis results into the Qdrant vector database.
Each analysis phase is stored as a separate point with its embedding,
allowing fine-grained retrieval of relevant past analyses.
"""

import logging
import uuid
from typing import Dict, List, Optional
from datetime import datetime

from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

from rag.rag_client import get_qdrant_client, COLLECTION_NAME, init_collection
from rag.embedding_service import create_analysis_embedding

logger = logging.getLogger("knowledge_store")


def store_phase_analysis(
    video_id: str,
    phase_index: int,
    phase_type: str,
    speech_text: str,
    visual_context: str,
    behavior_label: str,
    ai_insight: str,
    user_email: str,
    duration_seconds: float = 0.0,
    filename: str = "",
    total_duration: float = 0.0,
    client: QdrantClient = None,
) -> str:
    """
    Store a single phase analysis result into the knowledge base.

    Each phase of a video analysis is stored as a separate vector point,
    enabling retrieval of specific phase-level insights. The quality_score
    starts at 0.0 (neutral) and is updated based on user feedback.

    Returns the point ID used for storage.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    # Generate embedding from analysis components
    embedding = create_analysis_embedding(
        speech_text=speech_text,
        visual_context=visual_context,
        phase_type=phase_type,
        ai_insight=ai_insight,
    )

    # Create a deterministic ID based on video_id and phase_index
    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{video_id}_{phase_index}"))

    payload = {
        "video_id": video_id,
        "phase_index": phase_index,
        "phase_type": phase_type,
        "speech_text": speech_text[:5000],
        "visual_context": visual_context[:3000],
        "behavior_label": behavior_label,
        "ai_insight": ai_insight[:5000],
        "user_email": user_email,
        "quality_score": 0.0,
        "feedback_count": 0,
        "duration_seconds": duration_seconds,
        "created_at": datetime.utcnow().isoformat(),
        "metadata": {
            "filename": filename,
            "total_duration": total_duration,
        },
    }

    point = PointStruct(
        id=point_id,
        vector=embedding,
        payload=payload,
    )

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[point],
    )

    logger.info(
        f"Stored analysis for video={video_id}, phase={phase_index}, "
        f"type={phase_type}, point_id={point_id}"
    )
    return point_id


def store_video_analysis(
    video_id: str,
    phases: List[Dict],
    user_email: str,
    filename: str = "",
    total_duration: float = 0.0,
) -> List[str]:
    """
    Store all phase analyses for a complete video into the knowledge base.

    Iterates through each phase and stores it individually, enabling
    phase-level retrieval. Returns a list of point IDs.
    """
    client = get_qdrant_client()
    init_collection(client)

    point_ids = []
    for i, phase in enumerate(phases):
        point_id = store_phase_analysis(
            video_id=video_id,
            phase_index=i,
            phase_type=phase.get("phase_type", phase.get("behavior_label", "unknown")),
            speech_text=phase.get("speech_text", ""),
            visual_context=phase.get("visual_context", ""),
            behavior_label=phase.get("behavior_label", ""),
            ai_insight=phase.get("ai_insight", phase.get("insight", "")),
            user_email=user_email,
            duration_seconds=phase.get("duration_seconds", 0.0),
            filename=filename,
            total_duration=total_duration,
            client=client,
        )
        point_ids.append(point_id)

    logger.info(
        f"Stored {len(point_ids)} phases for video={video_id}"
    )
    return point_ids


def update_quality_score(
    video_id: str,
    phase_index: int,
    rating: int,
    client: QdrantClient = None,
):
    """
    Update the quality score of a stored analysis based on user feedback.

    Positive feedback (rating=1) increases the score by 0.2 (max 1.0).
    Negative feedback (rating=-1) decreases the score by 0.3 (min -1.0).
    Higher quality scores make the analysis more likely to be retrieved
    as a reference example in future RAG queries.
    """
    if client is None:
        client = get_qdrant_client()

    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{video_id}_{phase_index}"))

    # Retrieve current point
    points = client.retrieve(
        collection_name=COLLECTION_NAME,
        ids=[point_id],
        with_payload=True,
    )

    if not points:
        logger.warning(f"Point not found: {point_id}")
        return

    current = points[0].payload
    current_score = current.get("quality_score", 0.0)
    feedback_count = current.get("feedback_count", 0)

    # Apply rating adjustment
    if rating > 0:
        new_score = min(current_score + 0.2, 1.0)
    elif rating < 0:
        new_score = max(current_score - 0.3, -1.0)
    else:
        new_score = current_score

    # Update payload
    client.set_payload(
        collection_name=COLLECTION_NAME,
        payload={
            "quality_score": new_score,
            "feedback_count": feedback_count + 1,
        },
        points=[point_id],
    )

    logger.info(
        f"Updated quality score for {point_id}: "
        f"{current_score:.2f} -> {new_score:.2f} (feedback #{feedback_count + 1})"
    )

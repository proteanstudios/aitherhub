"""
Knowledge Retriever for aitherhub RAG system.

Searches the Qdrant vector database for past analysis results that are
similar to the current video being analyzed. Retrieved examples are used
to augment the LLM prompt, improving analysis quality over time.
"""

import logging
from typing import Dict, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, Range, MatchValue

from rag.rag_client import get_qdrant_client, COLLECTION_NAME, init_collection
from rag.embedding_service import create_analysis_embedding

logger = logging.getLogger("knowledge_retriever")


def retrieve_similar_analyses(
    speech_text: str,
    visual_context: str,
    phase_type: str = "",
    top_k: int = 5,
    min_quality_score: float = 0.0,
    exclude_video_id: str = None,
    user_email: str = None,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve past analysis results similar to the current phase.

    Searches the knowledge base using cosine similarity between the
    current phase's embedding and stored embeddings. Results are filtered
    by quality score to ensure only high-quality examples are returned.

    Parameters:
        speech_text: Current phase's speech transcript
        visual_context: Current phase's visual description
        phase_type: Current phase type for optional filtering
        top_k: Number of results to return (default: 5)
        min_quality_score: Minimum quality threshold (default: 0.0)
        exclude_video_id: Video ID to exclude (prevents self-reference)
        user_email: Optional filter by user for personalized results
        client: Optional pre-existing Qdrant client

    Returns:
        List of dictionaries containing similar past analyses with
        their similarity scores.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    # Generate embedding for the current phase
    query_embedding = create_analysis_embedding(
        speech_text=speech_text,
        visual_context=visual_context,
        phase_type=phase_type,
    )

    # Build filter conditions
    must_conditions = [
        FieldCondition(
            key="quality_score",
            range=Range(gte=min_quality_score),
        )
    ]

    must_not_conditions = []

    if exclude_video_id:
        must_not_conditions.append(
            FieldCondition(
                key="video_id",
                match=MatchValue(value=exclude_video_id),
            )
        )

    # Build the filter
    search_filter = Filter(
        must=must_conditions,
        must_not=must_not_conditions if must_not_conditions else None,
    )

    # Perform similarity search
    results = client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_embedding,
        query_filter=search_filter,
        limit=top_k,
        with_payload=True,
    )

    # Format results
    similar_analyses = []
    for hit in results:
        similar_analyses.append({
            "score": hit.score,
            "phase_type": hit.payload.get("phase_type", ""),
            "speech_text": hit.payload.get("speech_text", ""),
            "visual_context": hit.payload.get("visual_context", ""),
            "behavior_label": hit.payload.get("behavior_label", ""),
            "ai_insight": hit.payload.get("ai_insight", ""),
            "quality_score": hit.payload.get("quality_score", 0.0),
            "video_id": hit.payload.get("video_id", ""),
            "duration_seconds": hit.payload.get("duration_seconds", 0.0),
        })

    logger.info(
        f"Retrieved {len(similar_analyses)} similar analyses "
        f"(min_quality={min_quality_score}, top_k={top_k})"
    )
    return similar_analyses


def retrieve_best_practices(
    phase_type: str,
    top_k: int = 3,
    min_quality_score: float = 0.5,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve the highest-rated analysis examples for a specific phase type.

    Unlike retrieve_similar_analyses which uses content similarity,
    this function focuses on finding the best-rated examples of a
    specific phase type (e.g., best "product_demo" analyses).
    These serve as gold-standard references in the RAG prompt.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    # Filter by phase type and high quality score
    search_filter = Filter(
        must=[
            FieldCondition(
                key="phase_type",
                match=MatchValue(value=phase_type),
            ),
            FieldCondition(
                key="quality_score",
                range=Range(gte=min_quality_score),
            ),
        ]
    )

    # Use a zero vector to get results sorted by quality (payload filtering)
    # Instead, we scroll with filter and sort by quality_score
    results, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=search_filter,
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    )

    # Sort by quality_score descending
    results.sort(key=lambda p: p.payload.get("quality_score", 0.0), reverse=True)

    best_practices = []
    for point in results[:top_k]:
        best_practices.append({
            "phase_type": point.payload.get("phase_type", ""),
            "speech_text": point.payload.get("speech_text", ""),
            "visual_context": point.payload.get("visual_context", ""),
            "ai_insight": point.payload.get("ai_insight", ""),
            "quality_score": point.payload.get("quality_score", 0.0),
        })

    logger.info(
        f"Retrieved {len(best_practices)} best practices for phase_type={phase_type}"
    )
    return best_practices

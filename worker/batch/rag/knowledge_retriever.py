"""
Knowledge Retriever for aitherhub RAG system (v2 - Extended).

Searches the Qdrant vector database for past analysis results that are
similar to the current video being analyzed. Retrieved examples are used
to augment the LLM prompt, improving analysis quality over time.

v2 Extensions:
- Sales-aware retrieval (filter by GMV range, CVR, etc.)
- Liver-specific retrieval (personalized to streamer)
- Screen recording metrics retrieval
- Top performer retrieval (highest GMV streams)
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
    sales_context: str = "",
    top_k: int = 5,
    min_quality_score: float = 0.0,
    exclude_video_id: str = None,
    liver_id: str = None,
    user_email: str = None,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve past analysis results similar to the current phase.

    Searches the knowledge base using cosine similarity between the
    current phase's embedding and stored embeddings. Now includes
    sales context in the embedding for performance-aware retrieval.

    Parameters:
        speech_text: Current phase's speech transcript
        visual_context: Current phase's visual description
        phase_type: Current phase type for optional filtering
        sales_context: Formatted sales/metrics data for embedding
        top_k: Number of results to return (default: 5)
        min_quality_score: Minimum quality threshold (default: 0.0)
        exclude_video_id: Video ID to exclude (prevents self-reference)
        liver_id: Filter by specific liver for personalized results
        user_email: Optional filter by user
        client: Optional pre-existing Qdrant client

    Returns:
        List of dictionaries containing similar past analyses with
        their similarity scores and sales data.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    # Generate embedding including sales context
    query_embedding = create_analysis_embedding(
        speech_text=speech_text,
        visual_context=visual_context,
        phase_type=phase_type,
        sales_context=sales_context,
    )

    # Build filter conditions
    must_conditions = [
        FieldCondition(
            key="quality_score",
            range=Range(gte=min_quality_score),
        )
    ]

    # Filter by liver_id for personalized results
    if liver_id:
        must_conditions.append(
            FieldCondition(
                key="liver_id",
                match=MatchValue(value=liver_id),
            )
        )

    must_not_conditions = []
    if exclude_video_id:
        must_not_conditions.append(
            FieldCondition(
                key="video_id",
                match=MatchValue(value=exclude_video_id),
            )
        )

    search_filter = Filter(
        must=must_conditions,
        must_not=must_not_conditions if must_not_conditions else None,
    )

    results = client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_embedding,
        query_filter=search_filter,
        limit=top_k,
        with_payload=True,
    )

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
            # v2: Sales data
            "sales_data": hit.payload.get("sales_data", {}),
            "set_products": hit.payload.get("set_products", []),
            "screen_metrics": hit.payload.get("screen_metrics", {}),
            # v2: Liver data
            "liver_id": hit.payload.get("liver_id", ""),
            "liver_name": hit.payload.get("liver_name", ""),
            # v2: Metadata
            "data_source": hit.payload.get("metadata", {}).get("data_source", ""),
            "stream_date": hit.payload.get("metadata", {}).get("stream_date", ""),
        })

    logger.info(
        f"Retrieved {len(similar_analyses)} similar analyses "
        f"(liver={liver_id}, min_quality={min_quality_score}, top_k={top_k})"
    )
    return similar_analyses


def retrieve_liver_history(
    liver_id: str,
    top_k: int = 10,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve all past analyses for a specific liver (streamer).

    Returns the most recent analyses for the given liver, enabling
    personalized insights based on their streaming history.
    Includes sales performance data for trend analysis.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    search_filter = Filter(
        must=[
            FieldCondition(
                key="liver_id",
                match=MatchValue(value=liver_id),
            )
        ]
    )

    results, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=search_filter,
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    )

    # Sort by created_at descending (most recent first)
    results.sort(
        key=lambda p: p.payload.get("created_at", ""),
        reverse=True,
    )

    history = []
    for point in results[:top_k]:
        history.append({
            "video_id": point.payload.get("video_id", ""),
            "phase_type": point.payload.get("phase_type", ""),
            "ai_insight": point.payload.get("ai_insight", ""),
            "sales_data": point.payload.get("sales_data", {}),
            "screen_metrics": point.payload.get("screen_metrics", {}),
            "quality_score": point.payload.get("quality_score", 0.0),
            "created_at": point.payload.get("created_at", ""),
            "stream_date": point.payload.get("metadata", {}).get("stream_date", ""),
        })

    logger.info(f"Retrieved {len(history)} history entries for liver={liver_id}")
    return history


def retrieve_top_performers(
    min_gmv: float = 0,
    top_k: int = 5,
    phase_type: str = None,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve analyses from the highest-performing streams.

    Filters by GMV threshold and returns analyses from streams
    that achieved the best sales results. These serve as
    gold-standard references for the RAG prompt.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    must_conditions = [
        FieldCondition(
            key="sales_data.gmv",
            range=Range(gte=min_gmv),
        )
    ]

    if phase_type:
        must_conditions.append(
            FieldCondition(
                key="phase_type",
                match=MatchValue(value=phase_type),
            )
        )

    search_filter = Filter(must=must_conditions)

    results, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=search_filter,
        limit=top_k * 3,
        with_payload=True,
        with_vectors=False,
    )

    # Sort by GMV descending
    results.sort(
        key=lambda p: p.payload.get("sales_data", {}).get("gmv", 0),
        reverse=True,
    )

    top_performers = []
    seen_videos = set()
    for point in results:
        vid = point.payload.get("video_id", "")
        if vid in seen_videos:
            continue
        seen_videos.add(vid)

        top_performers.append({
            "video_id": vid,
            "phase_type": point.payload.get("phase_type", ""),
            "speech_text": point.payload.get("speech_text", ""),
            "ai_insight": point.payload.get("ai_insight", ""),
            "sales_data": point.payload.get("sales_data", {}),
            "set_products": point.payload.get("set_products", []),
            "liver_id": point.payload.get("liver_id", ""),
            "liver_name": point.payload.get("liver_name", ""),
            "quality_score": point.payload.get("quality_score", 0.0),
        })

        if len(top_performers) >= top_k:
            break

    logger.info(
        f"Retrieved {len(top_performers)} top performers (min_gmv={min_gmv})"
    )
    return top_performers


def retrieve_best_practices(
    phase_type: str,
    top_k: int = 3,
    min_quality_score: float = 0.5,
    client: QdrantClient = None,
) -> List[Dict]:
    """
    Retrieve the highest-rated analysis examples for a specific phase type.

    Now includes sales data in the returned results for
    performance-contextualized best practices.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

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

    results, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=search_filter,
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    )

    results.sort(
        key=lambda p: p.payload.get("quality_score", 0.0),
        reverse=True,
    )

    best_practices = []
    for point in results[:top_k]:
        best_practices.append({
            "phase_type": point.payload.get("phase_type", ""),
            "speech_text": point.payload.get("speech_text", ""),
            "visual_context": point.payload.get("visual_context", ""),
            "ai_insight": point.payload.get("ai_insight", ""),
            "quality_score": point.payload.get("quality_score", 0.0),
            # v2: Include sales data
            "sales_data": point.payload.get("sales_data", {}),
            "screen_metrics": point.payload.get("screen_metrics", {}),
        })

    logger.info(
        f"Retrieved {len(best_practices)} best practices for phase_type={phase_type}"
    )
    return best_practices

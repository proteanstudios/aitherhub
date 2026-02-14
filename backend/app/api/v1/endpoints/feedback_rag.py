"""
RAG Feedback API Endpoint for aitherhub.

Allows users to rate analysis results (good/bad), which updates
the quality score in the Qdrant knowledge base. Higher-rated analyses
are prioritized in future RAG retrievals.

This is a separate endpoint from the main feedback.py to avoid
breaking existing functionality.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
import logging

logger = logging.getLogger("feedback_rag_api")

router = APIRouter(prefix="/feedback-rag", tags=["RAG Feedback"])


# ============================================================
# Schemas
# ============================================================

class RAGFeedbackCreate(BaseModel):
    """Schema for submitting feedback on an analysis result."""
    video_id: str = Field(..., description="ID of the analyzed video")
    phase_index: int = Field(..., ge=0, description="Index of the phase being rated")
    rating: int = Field(
        ...,
        ge=-1,
        le=1,
        description="Rating: -1 (bad), 0 (neutral), 1 (good)"
    )
    comment: Optional[str] = Field(
        None,
        max_length=1000,
        description="Optional comment explaining the rating"
    )


class RAGFeedbackResponse(BaseModel):
    """Schema for feedback submission response."""
    success: bool
    message: str
    new_quality_score: Optional[float] = None


class KnowledgeStatsResponse(BaseModel):
    """Schema for knowledge base statistics."""
    total_entries: int
    high_quality_entries: int
    phase_type_distribution: dict
    average_quality_score: float


# ============================================================
# Endpoints
# ============================================================

@router.post("", response_model=RAGFeedbackResponse)
async def submit_rag_feedback(feedback: RAGFeedbackCreate):
    """
    Submit feedback on a video analysis result.

    This endpoint updates the quality score of the corresponding
    analysis in the Qdrant knowledge base. Analyses with higher
    quality scores are more likely to be used as reference examples
    in future RAG-augmented analyses.
    """
    try:
        from rag.knowledge_store import update_quality_score
        from rag.rag_client import get_qdrant_client, COLLECTION_NAME
        import uuid

        client = get_qdrant_client()

        update_quality_score(
            video_id=feedback.video_id,
            phase_index=feedback.phase_index,
            rating=feedback.rating,
            client=client,
        )

        point_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_DNS,
                f"{feedback.video_id}_{feedback.phase_index}"
            )
        )
        points = client.retrieve(
            collection_name=COLLECTION_NAME,
            ids=[point_id],
            with_payload=True,
        )

        new_score = None
        if points:
            new_score = points[0].payload.get("quality_score")

        return RAGFeedbackResponse(
            success=True,
            message="RAGフィードバックが正常に記録されました",
            new_quality_score=new_score,
        )

    except Exception as e:
        logger.error(f"Failed to submit RAG feedback: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"RAGフィードバックの記録に失敗しました: {str(e)}"
        )


@router.get("/stats", response_model=KnowledgeStatsResponse)
async def get_knowledge_stats():
    """
    Get statistics about the RAG knowledge base.

    Returns the total number of stored analyses, the number of
    high-quality entries, and the distribution of phase types.
    """
    try:
        from rag.rag_client import get_qdrant_client, COLLECTION_NAME
        from qdrant_client.models import Filter, FieldCondition, Range

        client = get_qdrant_client()

        collection_info = client.get_collection(COLLECTION_NAME)
        total_entries = collection_info.points_count

        high_quality_filter = Filter(
            must=[
                FieldCondition(
                    key="quality_score",
                    range=Range(gte=0.5),
                )
            ]
        )
        high_quality_count = client.count(
            collection_name=COLLECTION_NAME,
            count_filter=high_quality_filter,
        ).count

        all_points, _ = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=10000,
            with_payload=["phase_type", "quality_score"],
            with_vectors=False,
        )

        phase_distribution = {}
        total_score = 0.0
        for point in all_points:
            pt = point.payload.get("phase_type", "unknown")
            phase_distribution[pt] = phase_distribution.get(pt, 0) + 1
            total_score += point.payload.get("quality_score", 0.0)

        avg_score = total_score / max(total_entries, 1)

        return KnowledgeStatsResponse(
            total_entries=total_entries,
            high_quality_entries=high_quality_count,
            phase_type_distribution=phase_distribution,
            average_quality_score=round(avg_score, 3),
        )

    except Exception as e:
        logger.error(f"Failed to get knowledge stats: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"統計情報の取得に失敗しました: {str(e)}"
        )

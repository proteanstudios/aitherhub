from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.repository.feedback_repo import create_feedback
from app.schemas.feedback_schema import FeedbackRequest, FeedbackResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["Feedback"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=FeedbackResponse)
async def submit_feedback(
    payload: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Submit feedback endpoint - requires authentication
    """
    try:
        user_id = current_user["id"]

        feedback = await create_feedback(
            db=db,
            user_id=user_id,
            content=payload.content,
        )

        logger.info(f"[FEEDBACK] User {user_id} submitted feedback: {feedback.id}")

        return FeedbackResponse(
            id=feedback.id,
            user_id=feedback.user_id,
            content=feedback.content,
            created_at=feedback.created_at,
            updated_at=feedback.updated_at,
        )
    except Exception as e:
        logger.error(f"[FEEDBACK] Error creating feedback: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="フィードバックの送信に失敗しました",
        )

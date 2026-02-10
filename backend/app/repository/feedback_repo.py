# app/repository/feedback_repo.py

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.orm.feedback import Feedback


async def create_feedback(
    db: AsyncSession,
    user_id: int,
    content: str,
) -> Feedback:
    """Create a new feedback entry"""
    feedback = Feedback(
        user_id=user_id,
        content=content,
    )

    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    return feedback


async def get_feedback_by_id(
    db: AsyncSession,
    feedback_id: str,
) -> Feedback | None:
    """Get feedback by ID"""
    result = await db.execute(
        select(Feedback).where(Feedback.id == feedback_id)
    )
    return result.scalar_one_or_none()


async def get_feedbacks_by_user(
    db: AsyncSession,
    user_id: int,
    limit: int = 100,
    offset: int = 0,
) -> list[Feedback]:
    """Get all feedbacks by user ID"""
    result = await db.execute(
        select(Feedback)
        .where(Feedback.user_id == user_id)
        .order_by(Feedback.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


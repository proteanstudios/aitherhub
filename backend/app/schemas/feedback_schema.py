from pydantic import BaseModel, constr
from datetime import datetime
from uuid import UUID


class FeedbackRequest(BaseModel):
    content: constr(min_length=1, max_length=10000)

    class Config:
        orm_mode = True


class FeedbackResponse(BaseModel):
    id: UUID
    user_id: int
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


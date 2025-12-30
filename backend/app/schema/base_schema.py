from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ModelBaseInfo(BaseModel):
    """Base response schema with timestamp metadata"""
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class Blank(BaseModel):
    """Empty response"""
    pass

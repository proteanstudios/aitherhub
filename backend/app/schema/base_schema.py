from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel
from pydantic import ConfigDict


class ModelBaseInfo(BaseModel):
    """Base response schema with timestamp metadata"""
    id: str | UUID
    created_at: datetime
    updated_at: datetime

    # Pydantic v2: allow creating model from ORM objects/attributes
    model_config = ConfigDict(from_attributes=True)


class Blank(BaseModel):
    """Empty response"""
    pass

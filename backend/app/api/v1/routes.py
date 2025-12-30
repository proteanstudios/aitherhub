from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.video import router as video_router

routers = APIRouter()
routers.include_router(auth_router, prefix="/auth", tags=["Auth"])
routers.include_router(video_router, prefix="/videos")

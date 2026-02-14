from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.video import router as video_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.feedback import router as feedback_router
from app.api.v1.endpoints.external_api import router as external_api_router

routers = APIRouter()
routers.include_router(auth_router, prefix="/auth", tags=["Auth"])
routers.include_router(video_router) 
routers.include_router(chat_router)
routers.include_router(feedback_router)
routers.include_router(external_api_router)

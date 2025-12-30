from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.repository.auth_repo import (
    get_user_by_email,
    create_user_with_password,
    update_user_password,
    verify_user_password,
)
from app.schemas.auth_schema import RegisterRequest, LoginRequest, ChangePasswordRequest
from app.utils.jwt import create_access_token, create_refresh_token

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    logger.info("[REGISTER] payload=%s", payload.model_dump())

    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = await create_user_with_password(
        db=db,
        email=payload.email,
        password=payload.password,
    )

    # Generate JWT tokens
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    return {
        "id": user.id,
        "email": user.email,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post("/login")
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Login endpoint - authenticate user and return JWT tokens
    """
    user = await get_user_by_email(db, payload.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    valid = await verify_user_password(db, payload.email, payload.password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }



@router.get("/me", status_code=status.HTTP_200_OK)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    ):
    """
    Get current user information from JWT token
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )

    return {
        "success": True,
        "data": current_user,
    }


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """
    Logout endpoint - client should clear tokens
    """
    return {"message": "Logged out successfully"}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Change password for authenticated user
    """
    logger.info("[CHANGE_PASSWORD] user_id=%s", current_user.get("id"))
    
    # Validate passwords match
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password and confirm password do not match",
        )
    
    # Verify current password
    user = await get_user_by_email(db, current_user["email"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Verify current password is correct
    valid = await verify_user_password(db, current_user["email"], payload.current_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )
    
    # Update password
    await update_user_password(db, current_user["id"], payload.new_password)
    
    return {"message": "Password changed successfully"}

"""
LCJ Account Linking API

AitherhubユーザーとLCJライバーアカウントの紐付けを管理するエンドポイント。
ユーザーがLCJのライバーメールアドレスを入力すると、LCJ側のAPIで
ライバー情報を取得し、紐付けを保存する。
"""

import os
import logging
import requests
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.repository.auth_repo import get_user_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lcj", tags=["LCJ Linking"])

LCJ_BASE_URL = os.getenv("LCJ_WEBHOOK_URL", "").replace("/api/aitherhub/webhook", "")
LCJ_WEBHOOK_SECRET = os.getenv("LCJ_WEBHOOK_SECRET", "")


# --- Request / Response schemas ---

class LinkLCJRequest(BaseModel):
    liver_email: str = Field(..., description="LCJライバーのメールアドレス")


class LCJLinkStatus(BaseModel):
    linked: bool
    liver_email: str | None = None
    liver_name: str | None = None
    linked_at: str | None = None


# --- Helper: LCJ APIでライバー情報を取得 ---

def _verify_liver_on_lcj(email: str) -> dict | None:
    """
    LCJ側のAPIにライバーメールアドレスを問い合わせ、
    ライバー情報を返す。見つからなければNone。
    """
    if not LCJ_BASE_URL:
        logger.warning("LCJ_WEBHOOK_URL not configured, cannot verify liver")
        return None

    url = f"{LCJ_BASE_URL}/api/aitherhub/verify-liver"
    try:
        resp = requests.post(
            url,
            json={"secret": LCJ_WEBHOOK_SECRET, "email": email},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("found"):
                return data
        return None
    except Exception as e:
        logger.error(f"LCJ verify-liver request failed: {e}")
        return None


# --- Endpoints ---

@router.get("/link-status", response_model=LCJLinkStatus)
async def get_link_status(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """現在のLCJ連携状態を取得する"""
    user = await get_user_by_id(db, current_user["id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.lcj_liver_email:
        return LCJLinkStatus(
            linked=True,
            liver_email=user.lcj_liver_email,
            liver_name=user.lcj_liver_name,
            linked_at=user.lcj_linked_at,
        )
    return LCJLinkStatus(linked=False)


class VerifyLiverRequest(BaseModel):
    email: str = Field(..., description="LCJライバーのメールアドレス")


@router.post("/verify-liver")
async def verify_liver(
    payload: VerifyLiverRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    LCJ側でライバーの存在を確認する。
    連携前のプレビュー用。
    """
    liver_info = _verify_liver_on_lcj(payload.email)
    if not liver_info:
        return {"found": False}
    return {
        "found": True,
        "name": liver_info.get("name", ""),
        "email": payload.email,
    }


@router.post("/link")
async def link_lcj_account(
    payload: LinkLCJRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    LCJライバーアカウントと紐付ける。
    LCJ側でライバーの存在を確認し、成功すればユーザーに紐付け情報を保存する。
    """
    user = await get_user_by_id(db, current_user["id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # LCJ側でライバーを確認
    liver_info = _verify_liver_on_lcj(payload.liver_email)
    if not liver_info:
        raise HTTPException(
            status_code=400,
            detail="LCJにこのメールアドレスのライバーが見つかりません。LCJに登録されているメールアドレスを入力してください。",
        )

    # 紐付け情報を保存
    now = datetime.now(timezone.utc).isoformat()
    user.lcj_liver_email = payload.liver_email
    user.lcj_liver_name = liver_info.get("name", "")
    user.lcj_linked_at = now
    await db.commit()
    await db.refresh(user)

    logger.info(
        f"LCJ linked: user={current_user['email']} -> liver={payload.liver_email} "
        f"(name={liver_info.get('name')})"
    )

    return {
        "success": True,
        "message": "LCJ連携が完了しました",
        "liver_name": liver_info.get("name", ""),
        "liver_email": payload.liver_email,
    }


@router.post("/unlink")
async def unlink_lcj_account(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """LCJ連携を解除する"""
    user = await get_user_by_id(db, current_user["id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.lcj_liver_email:
        raise HTTPException(status_code=400, detail="LCJ連携されていません")

    old_email = user.lcj_liver_email
    user.lcj_liver_email = None
    user.lcj_liver_name = None
    user.lcj_linked_at = None
    await db.commit()

    logger.info(f"LCJ unlinked: user={current_user['email']} (was: {old_email})")

    return {"success": True, "message": "LCJ連携を解除しました"}

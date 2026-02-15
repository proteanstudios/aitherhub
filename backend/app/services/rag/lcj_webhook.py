"""
LCJ Webhook Client

Aitherhubの動画解析完了時に、LCJのWebhook APIに解析結果を送信し、
ライバーのマイページ（配信履歴）に自動反映させる。

環境変数:
  LCJ_WEBHOOK_URL: LCJのWebhookエンドポイントURL
  LCJ_WEBHOOK_SECRET: 認証用シークレットキー
"""

import os
import logging
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime

logger = logging.getLogger("lcj_webhook")

# Configuration
LCJ_WEBHOOK_URL = os.getenv("LCJ_WEBHOOK_URL", "")
LCJ_WEBHOOK_SECRET = os.getenv("LCJ_WEBHOOK_SECRET", "")
LCJ_WEBHOOK_TIMEOUT = int(os.getenv("LCJ_WEBHOOK_TIMEOUT", "30"))


def send_analysis_to_lcj(
    *,
    # ライバー識別
    liver_email: str = "",
    liver_id: Optional[int] = None,
    
    # 配信基本情報
    brand_id: int,
    livestream_date: str,
    streamer_name: str,
    platform: str = "TikTok",
    
    # パフォーマンスメトリクス
    sales_amount: Optional[float] = None,
    duration: Optional[int] = None,
    viewer_count: Optional[int] = None,
    order_count: Optional[int] = None,
    gmv: Optional[float] = None,
    product_clicks: Optional[int] = None,
    impressions: Optional[int] = None,
    sales_count: Optional[int] = None,
    cart_add_count: Optional[int] = None,
    
    # 詳細メトリクス
    peak_viewers: Optional[int] = None,
    new_followers: Optional[int] = None,
    avg_view_duration: Optional[float] = None,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    shares: Optional[int] = None,
    avg_price: Optional[float] = None,
    
    # 効率指標
    ctr: Optional[str] = None,
    cvr: Optional[str] = None,
    ctor: Optional[str] = None,
    
    # AI解析結果
    ai_advice: Optional[str] = None,
    ai_structured_advice: Optional[Dict] = None,
    
    # スクリーンショット
    screenshot_url: Optional[str] = None,
    screenshot_key: Optional[str] = None,
    
    # 既存レコード更新用
    livestream_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Aitherhubの解析結果をLCJのWebhook APIに送信する。
    
    Returns:
        dict: LCJからのレスポンス（success, id, action等）
    
    Raises:
        ValueError: LCJ_WEBHOOK_URLが未設定の場合
        requests.RequestException: 通信エラーの場合
    """
    if not LCJ_WEBHOOK_URL:
        logger.warning("LCJ_WEBHOOK_URL is not set. Skipping webhook.")
        return {"success": False, "error": "LCJ_WEBHOOK_URL not configured"}
    
    if not LCJ_WEBHOOK_SECRET:
        logger.warning("LCJ_WEBHOOK_SECRET is not set. Skipping webhook.")
        return {"success": False, "error": "LCJ_WEBHOOK_SECRET not configured"}
    
    # ペイロードの構築
    payload: Dict[str, Any] = {
        "secret": LCJ_WEBHOOK_SECRET,
        "brandId": brand_id,
        "livestreamDate": livestream_date,
        "streamerName": streamer_name,
        "platform": platform,
    }
    
    # オプションフィールド
    if liver_email:
        payload["liverEmail"] = liver_email
    if liver_id is not None:
        payload["liverId"] = liver_id
    if sales_amount is not None:
        payload["salesAmount"] = sales_amount
    if duration is not None:
        payload["duration"] = duration
    if viewer_count is not None:
        payload["viewerCount"] = viewer_count
    if order_count is not None:
        payload["orderCount"] = order_count
    if gmv is not None:
        payload["gmv"] = gmv
    if product_clicks is not None:
        payload["productClicks"] = product_clicks
    if impressions is not None:
        payload["impressions"] = impressions
    if sales_count is not None:
        payload["salesCount"] = sales_count
    if cart_add_count is not None:
        payload["cartAddCount"] = cart_add_count
    if peak_viewers is not None:
        payload["peakViewers"] = peak_viewers
    if new_followers is not None:
        payload["newFollowers"] = new_followers
    if avg_view_duration is not None:
        payload["avgViewDuration"] = avg_view_duration
    if likes is not None:
        payload["likes"] = likes
    if comments is not None:
        payload["comments"] = comments
    if shares is not None:
        payload["shares"] = shares
    if avg_price is not None:
        payload["avgPrice"] = avg_price
    if ctr:
        payload["ctr"] = ctr
    if cvr:
        payload["cvr"] = cvr
    if ctor:
        payload["ctor"] = ctor
    if ai_advice:
        payload["aiAdvice"] = ai_advice
    if ai_structured_advice:
        payload["aiStructuredAdvice"] = ai_structured_advice
    if screenshot_url:
        payload["screenshotUrl"] = screenshot_url
    if screenshot_key:
        payload["screenshotKey"] = screenshot_key
    if livestream_id is not None:
        payload["livestreamId"] = livestream_id
    
    logger.info(
        f"Sending analysis to LCJ: streamer={streamer_name}, "
        f"date={livestream_date}, gmv={gmv}"
    )
    
    try:
        response = requests.post(
            LCJ_WEBHOOK_URL,
            json=payload,
            timeout=LCJ_WEBHOOK_TIMEOUT,
            headers={"Content-Type": "application/json"},
        )
        
        if response.status_code == 200:
            result = response.json()
            logger.info(
                f"LCJ webhook success: action={result.get('action')}, "
                f"id={result.get('id')}"
            )
            return result
        else:
            error_msg = f"LCJ webhook failed: status={response.status_code}, body={response.text[:200]}"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
    except requests.Timeout:
        logger.error(f"LCJ webhook timeout after {LCJ_WEBHOOK_TIMEOUT}s")
        return {"success": False, "error": "timeout"}
    except requests.RequestException as e:
        logger.error(f"LCJ webhook request error: {e}")
        return {"success": False, "error": str(e)}


def send_analysis_from_store_request(
    request_data: Dict[str, Any],
    ai_advice: str = "",
    ai_structured_advice: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    store_analysis_with_salesリクエストのデータからLCJ Webhookを送信する。
    
    external_api.pyの/analysis/storeエンドポイントから呼ばれるヘルパー関数。
    AnalysisWithSalesRequestのデータを変換してsend_analysis_to_lcjを呼ぶ。
    """
    sales_data = request_data.get("sales_data", {}) or {}
    
    return send_analysis_to_lcj(
        liver_email=request_data.get("user_email", ""),
        brand_id=request_data.get("brand_id", 0),
        livestream_date=request_data.get("stream_date", ""),
        streamer_name=request_data.get("liver_name", ""),
        platform=request_data.get("platform", "TikTok"),
        sales_amount=sales_data.get("gmv"),
        duration=int(sales_data.get("duration_minutes", 0)) if sales_data.get("duration_minutes") else None,
        viewer_count=sales_data.get("viewers"),
        order_count=sales_data.get("total_orders"),
        gmv=sales_data.get("gmv"),
        product_clicks=sales_data.get("product_clicks"),
        impressions=sales_data.get("impressions"),
        sales_count=sales_data.get("product_sales_count"),
        ctr=str(sales_data.get("live_ctr", "")) if sales_data.get("live_ctr") else None,
        cvr=str(sales_data.get("cvr", "")) if sales_data.get("cvr") else None,
        ai_advice=ai_advice,
        ai_structured_advice=ai_structured_advice,
    )

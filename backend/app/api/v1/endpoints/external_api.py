"""
External API Endpoints for aitherhub (v2 - Extended).

Provides public API endpoints for external system integration,
primarily with the LCJ live streaming platform (lcjmall.com).

v2 Extensions:
- Sales data ingestion endpoints (dashboard screenshots, JSON, CSV)
- Screen recording metrics extraction endpoint
- Liver history and performance endpoints
- Batch analysis endpoint for backfilling knowledge base

Add this file to: backend/app/api/v1/endpoints/external_api.py
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import Dict, List, Optional
import logging
import json
import tempfile
import os

logger = logging.getLogger("external_api")

router = APIRouter(prefix="/external", tags=["external"])


# ============================================================
# Schemas
# ============================================================

class SalesDataPayload(BaseModel):
    """Sales data from TikTok LIVE dashboard."""
    gmv: float = Field(0, description="Total GMV in JPY")
    total_orders: int = Field(0, description="Total order count")
    product_sales_count: int = Field(0, description="Total product units sold")
    viewers: int = Field(0, description="Total viewer count")
    impressions: int = Field(0, description="Total impressions")
    product_impressions: int = Field(0, description="Product impressions")
    product_clicks: int = Field(0, description="Product click count")
    live_ctr: float = Field(0, description="LIVE CTR percentage")
    cvr: float = Field(0, description="Conversion rate percentage")
    tap_through_rate: float = Field(0, description="Tap-through rate percentage")
    comment_rate: float = Field(0, description="Comment rate percentage")
    avg_gpm: float = Field(0, description="GMV per minute")
    duration_minutes: float = Field(0, description="Stream duration in minutes")
    follower_ratio: float = Field(0, description="Follower ratio percentage")
    traffic_sources: List[Dict] = Field(default_factory=list)


class SetProductPayload(BaseModel):
    """Set product (bundle) information."""
    name: str = Field(..., description="Product set name")
    price: float = Field(0, description="Selling price in JPY")
    original_price: float = Field(0, description="Original price in JPY")
    discount_rate: float = Field(0, description="Discount rate percentage")
    quantity_sold: int = Field(0, description="Number of sets sold")
    set_revenue: float = Field(0, description="Total revenue from this set")
    items: List[str] = Field(default_factory=list, description="Items in the set")


class AnalysisWithSalesRequest(BaseModel):
    """Request to store analysis with sales data."""
    video_id: str = Field(..., description="Video identifier")
    user_email: str = Field(..., description="User email")
    liver_id: str = Field("", description="Liver (streamer) account ID")
    liver_name: str = Field("", description="Liver display name")
    platform: str = Field("tiktok", description="Streaming platform")
    stream_date: str = Field("", description="Stream date (YYYY-MM-DD)")
    data_source: str = Field("clean", description="'clean' or 'screen_recording'")
    filename: str = Field("", description="Original filename")
    total_duration: float = Field(0, description="Total video duration in seconds")
    sales_data: Optional[SalesDataPayload] = None
    set_products: List[SetProductPayload] = Field(default_factory=list)
    phases: List[Dict] = Field(
        ...,
        description="List of phase analysis results"
    )


class LiverHistoryRequest(BaseModel):
    """Request for liver history."""
    liver_id: str = Field(..., description="Liver account ID")
    top_k: int = Field(10, ge=1, le=100)


class TopPerformerRequest(BaseModel):
    """Request for top performers."""
    min_gmv: float = Field(0, description="Minimum GMV threshold")
    top_k: int = Field(5, ge=1, le=50)
    phase_type: Optional[str] = None


class SimilarAnalysisRequest(BaseModel):
    """Request for similar analyses with sales context."""
    speech_text: str = Field("", description="Current speech text")
    visual_context: str = Field("", description="Current visual context")
    phase_type: str = Field("", description="Current phase type")
    sales_context: str = Field("", description="Sales context string")
    top_k: int = Field(5, ge=1, le=20)
    min_quality_score: float = Field(0.0)
    exclude_video_id: Optional[str] = None
    liver_id: Optional[str] = None


class KnowledgeStatsV2Response(BaseModel):
    """Extended knowledge base statistics."""
    total_entries: int
    high_quality_entries: int
    phase_type_distribution: Dict
    average_quality_score: float
    total_videos: int
    total_livers: int
    total_gmv: float
    avg_gmv_per_stream: float
    data_source_distribution: Dict


# ============================================================
# Endpoints: Analysis Storage with Sales Data
# ============================================================

@router.post("/analysis/store")
async def store_analysis_with_sales(request: AnalysisWithSalesRequest):
    """
    Store a complete video analysis with sales data into the knowledge base.

    This is the primary endpoint for LCJ system integration. After a video
    is analyzed, the LCJ system sends the analysis results along with
    sales data from the TikTok dashboard.

    Pattern A: Clean video + sales_data from dashboard screenshot
    Pattern B: Screen recording + screen_metrics extracted from frames
    """
    try:
        from rag.knowledge_store import store_video_analysis

        sales_dict = request.sales_data.dict() if request.sales_data else None
        products_list = [p.dict() for p in request.set_products]

        point_ids = store_video_analysis(
            video_id=request.video_id,
            phases=request.phases,
            user_email=request.user_email,
            filename=request.filename,
            total_duration=request.total_duration,
            liver_id=request.liver_id,
            liver_name=request.liver_name,
            sales_data=sales_dict,
            set_products=products_list,
            platform=request.platform,
            stream_date=request.stream_date,
            data_source=request.data_source,
        )

        return {
            "success": True,
            "message": f"{len(point_ids)}件のフェーズ分析を保存しました",
            "point_ids": point_ids,
            "video_id": request.video_id,
        }

    except Exception as e:
        logger.error(f"Failed to store analysis with sales: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Endpoints: Sales Data Ingestion
# ============================================================

@router.post("/sales/ingest-screenshot")
async def ingest_sales_screenshot(
    screenshot: UploadFile = File(..., description="TikTok dashboard screenshot"),
    video_id: str = Form("", description="Associated video ID"),
):
    """
    Extract sales data from a TikTok LIVE dashboard screenshot using OCR.

    Upload a screenshot of the TikTok LIVE dashboard and this endpoint
    will extract structured sales metrics using GPT-4o vision.
    """
    try:
        from rag.sales_data_ingester import ingest_from_dashboard_screenshot

        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".png"
        ) as tmp:
            content = await screenshot.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            sales_data = ingest_from_dashboard_screenshot(tmp_path)
        finally:
            os.unlink(tmp_path)

        return {
            "success": True,
            "video_id": video_id,
            "sales_data": sales_data,
        }

    except Exception as e:
        logger.error(f"Failed to ingest sales screenshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sales/ingest-products-screenshot")
async def ingest_products_screenshot(
    screenshot: UploadFile = File(..., description="Product sales screenshot"),
    video_id: str = Form("", description="Associated video ID"),
):
    """
    Extract set product data from a product sales screenshot using OCR.
    """
    try:
        from rag.sales_data_ingester import ingest_products_from_screenshot

        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".png"
        ) as tmp:
            content = await screenshot.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            set_products = ingest_products_from_screenshot(tmp_path)
        finally:
            os.unlink(tmp_path)

        return {
            "success": True,
            "video_id": video_id,
            "set_products": set_products,
        }

    except Exception as e:
        logger.error(f"Failed to ingest products screenshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sales/ingest-json")
async def ingest_sales_json(data: Dict):
    """
    Ingest sales data from a JSON payload (LCJ system API format).

    Accepts both flat format and nested LCJ format with
    sales_summary and products fields.
    """
    try:
        from rag.sales_data_ingester import ingest_from_lcj_api

        sales_data, set_products = ingest_from_lcj_api(data)

        return {
            "success": True,
            "sales_data": sales_data,
            "set_products": set_products,
        }

    except Exception as e:
        logger.error(f"Failed to ingest sales JSON: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Endpoints: Screen Recording Metrics
# ============================================================

@router.post("/metrics/extract-frame")
async def extract_frame_metrics(
    frame: UploadFile = File(..., description="Screen recording frame"),
):
    """
    Extract real-time metrics from a single screen recording frame.

    Uses GPT-4o vision to read TikTok LIVE UI overlay elements
    such as viewer count, likes, shopping rank, etc.
    """
    try:
        from rag.screen_metrics_extractor import extract_metrics_from_frame

        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".jpg"
        ) as tmp:
            content = await frame.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            metrics = extract_metrics_from_frame(tmp_path)
        finally:
            os.unlink(tmp_path)

        return {
            "success": True,
            "metrics": metrics,
        }

    except Exception as e:
        logger.error(f"Failed to extract frame metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Endpoints: Retrieval
# ============================================================

@router.post("/retrieve/similar")
async def retrieve_similar(request: SimilarAnalysisRequest):
    """
    Retrieve similar past analyses from the knowledge base.

    Supports sales-context-aware retrieval and liver-specific filtering.
    """
    try:
        from rag.knowledge_retriever import retrieve_similar_analyses

        results = retrieve_similar_analyses(
            speech_text=request.speech_text,
            visual_context=request.visual_context,
            phase_type=request.phase_type,
            sales_context=request.sales_context,
            top_k=request.top_k,
            min_quality_score=request.min_quality_score,
            exclude_video_id=request.exclude_video_id,
            liver_id=request.liver_id,
        )

        return {
            "success": True,
            "count": len(results),
            "results": results,
        }

    except Exception as e:
        logger.error(f"Failed to retrieve similar analyses: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retrieve/liver-history")
async def retrieve_liver_history(request: LiverHistoryRequest):
    """
    Retrieve analysis history for a specific liver (streamer).

    Returns past analyses with sales performance data for
    trend analysis and personalized insights.
    """
    try:
        from rag.knowledge_retriever import retrieve_liver_history as _retrieve

        history = _retrieve(
            liver_id=request.liver_id,
            top_k=request.top_k,
        )

        return {
            "success": True,
            "liver_id": request.liver_id,
            "count": len(history),
            "history": history,
        }

    except Exception as e:
        logger.error(f"Failed to retrieve liver history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retrieve/top-performers")
async def retrieve_top_performers(request: TopPerformerRequest):
    """
    Retrieve analyses from top-performing streams.

    Returns analyses from streams with the highest GMV,
    serving as benchmarks for comparison.
    """
    try:
        from rag.knowledge_retriever import retrieve_top_performers as _retrieve

        results = _retrieve(
            min_gmv=request.min_gmv,
            top_k=request.top_k,
            phase_type=request.phase_type,
        )

        return {
            "success": True,
            "count": len(results),
            "results": results,
        }

    except Exception as e:
        logger.error(f"Failed to retrieve top performers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Endpoints: Statistics
# ============================================================

@router.get("/stats")
async def get_extended_stats():
    """
    Get extended knowledge base statistics including sales data summary.
    """
    try:
        from rag.rag_client import get_qdrant_client, COLLECTION_NAME

        client = get_qdrant_client()

        collection_info = client.get_collection(COLLECTION_NAME)
        total_entries = collection_info.points_count

        # Scroll all points for aggregation
        all_points, _ = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=10000,
            with_payload=[
                "phase_type", "quality_score", "video_id",
                "liver_id", "sales_data", "metadata",
            ],
            with_vectors=False,
        )

        phase_distribution = {}
        data_source_distribution = {}
        total_score = 0.0
        high_quality = 0
        video_ids = set()
        liver_ids = set()
        total_gmv = 0.0
        gmv_count = 0

        for point in all_points:
            payload = point.payload

            # Phase distribution
            pt = payload.get("phase_type", "unknown")
            phase_distribution[pt] = phase_distribution.get(pt, 0) + 1

            # Quality
            qs = payload.get("quality_score", 0.0)
            total_score += qs
            if qs >= 0.5:
                high_quality += 1

            # Video and liver counts
            vid = payload.get("video_id", "")
            if vid:
                video_ids.add(vid)
            lid = payload.get("liver_id", "")
            if lid:
                liver_ids.add(lid)

            # Sales data aggregation
            sales = payload.get("sales_data", {})
            gmv = sales.get("gmv", 0) if sales else 0
            if gmv and vid not in video_ids:
                total_gmv += gmv
                gmv_count += 1

            # Data source distribution
            ds = payload.get("metadata", {}).get("data_source", "unknown")
            data_source_distribution[ds] = data_source_distribution.get(ds, 0) + 1

        avg_score = total_score / max(total_entries, 1)
        avg_gmv = total_gmv / max(gmv_count, 1)

        return KnowledgeStatsV2Response(
            total_entries=total_entries,
            high_quality_entries=high_quality,
            phase_type_distribution=phase_distribution,
            average_quality_score=round(avg_score, 3),
            total_videos=len(video_ids),
            total_livers=len(liver_ids),
            total_gmv=round(total_gmv, 0),
            avg_gmv_per_stream=round(avg_gmv, 0),
            data_source_distribution=data_source_distribution,
        )

    except Exception as e:
        logger.error(f"Failed to get extended stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

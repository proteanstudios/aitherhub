"""
Knowledge Store for aitherhub RAG system (v2 - Extended).

Stores video analysis results into the Qdrant vector database.
Each analysis phase is stored as a separate point with its embedding,
allowing fine-grained retrieval of relevant past analyses.

v2 Extensions:
- Sales data integration (GMV, orders, CVR, etc.)
- Set product data (product bundles with pricing and quantities)
- Screen recording metrics (viewer count, comments, purchases from UI overlay)
- Liver (streamer) account linking
- Platform metadata (TikTok, etc.)
"""

import logging
import uuid
from typing import Dict, List, Optional
from datetime import datetime

from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

from rag.rag_client import get_qdrant_client, COLLECTION_NAME, init_collection
from rag.embedding_service import create_analysis_embedding

logger = logging.getLogger("knowledge_store")


def store_phase_analysis(
    video_id: str,
    phase_index: int,
    phase_type: str,
    speech_text: str,
    visual_context: str,
    behavior_label: str,
    ai_insight: str,
    user_email: str,
    duration_seconds: float = 0.0,
    filename: str = "",
    total_duration: float = 0.0,
    liver_id: str = "",
    liver_name: str = "",
    sales_data: Optional[Dict] = None,
    set_products: Optional[List[Dict]] = None,
    screen_metrics: Optional[Dict] = None,
    platform: str = "tiktok",
    stream_date: str = "",
    data_source: str = "clean",
    client: QdrantClient = None,
) -> str:
    """
    Store a single phase analysis result into the knowledge base.

    Each phase of a video analysis is stored as a separate vector point,
    enabling retrieval of specific phase-level insights.

    Parameters:
        video_id: Unique video identifier
        phase_index: Phase number within the video
        phase_type: Type of phase (product_demo, price_explanation, etc.)
        speech_text: Transcribed speech content
        visual_context: Visual description from frame analysis
        behavior_label: Classified behavior label
        ai_insight: AI-generated insight for this phase
        user_email: User who uploaded the video
        duration_seconds: Duration of this phase
        filename: Original filename
        total_duration: Total video duration
        liver_id: Liver (streamer) account ID from LCJ system
        liver_name: Liver display name
        sales_data: Sales metrics from TikTok dashboard (Pattern A)
        set_products: Product bundle information (Pattern A)
        screen_metrics: Metrics extracted from screen recording (Pattern B)
        platform: Streaming platform (default: tiktok)
        stream_date: Date of the livestream
        data_source: "clean" (Pattern A) or "screen_recording" (Pattern B)
        client: Optional pre-existing Qdrant client

    Returns the point ID used for storage.
    """
    if client is None:
        client = get_qdrant_client()
        init_collection(client)

    # Build sales context string for embedding
    sales_context = _build_sales_context(sales_data, set_products, screen_metrics)

    # Generate embedding from analysis components + sales context
    embedding = create_analysis_embedding(
        speech_text=speech_text,
        visual_context=visual_context,
        phase_type=phase_type,
        ai_insight=ai_insight,
        sales_context=sales_context,
    )

    # Create a deterministic ID based on video_id and phase_index
    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{video_id}_{phase_index}"))

    payload = {
        # --- Core analysis data ---
        "video_id": video_id,
        "phase_index": phase_index,
        "phase_type": phase_type,
        "speech_text": speech_text[:5000],
        "visual_context": visual_context[:3000],
        "behavior_label": behavior_label,
        "ai_insight": ai_insight[:5000],
        "user_email": user_email,
        "quality_score": 0.0,
        "feedback_count": 0,
        "duration_seconds": duration_seconds,
        "created_at": datetime.utcnow().isoformat(),

        # --- Liver (streamer) data ---
        "liver_id": liver_id,
        "liver_name": liver_name,

        # --- Sales data (Pattern A: TikTok dashboard screenshot) ---
        "sales_data": sales_data or {},

        # --- Set products (Pattern A) ---
        "set_products": set_products or [],

        # --- Screen recording metrics (Pattern B: UI overlay) ---
        "screen_metrics": screen_metrics or {},

        # --- Metadata ---
        "metadata": {
            "filename": filename,
            "total_duration": total_duration,
            "platform": platform,
            "stream_date": stream_date,
            "data_source": data_source,
        },
    }

    point = PointStruct(
        id=point_id,
        vector=embedding,
        payload=payload,
    )

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[point],
    )

    logger.info(
        f"Stored analysis for video={video_id}, phase={phase_index}, "
        f"type={phase_type}, liver={liver_id}, data_source={data_source}, "
        f"point_id={point_id}"
    )
    return point_id


def store_video_analysis(
    video_id: str,
    phases: List[Dict],
    user_email: str,
    filename: str = "",
    total_duration: float = 0.0,
    liver_id: str = "",
    liver_name: str = "",
    sales_data: Optional[Dict] = None,
    set_products: Optional[List[Dict]] = None,
    screen_metrics: Optional[Dict] = None,
    platform: str = "tiktok",
    stream_date: str = "",
    data_source: str = "clean",
) -> List[str]:
    """
    Store all phase analyses for a complete video into the knowledge base.

    Iterates through each phase and stores it individually, enabling
    phase-level retrieval. Sales data and screen metrics are attached
    to every phase for comprehensive context during retrieval.

    Returns a list of point IDs.
    """
    client = get_qdrant_client()
    init_collection(client)

    point_ids = []
    for i, phase in enumerate(phases):
        # Phase-level screen metrics override video-level if available
        phase_screen_metrics = phase.get("screen_metrics", screen_metrics)

        point_id = store_phase_analysis(
            video_id=video_id,
            phase_index=i,
            phase_type=phase.get("phase_type", phase.get("behavior_label", "unknown")),
            speech_text=phase.get("speech_text", ""),
            visual_context=phase.get("visual_context", ""),
            behavior_label=phase.get("behavior_label", ""),
            ai_insight=phase.get("ai_insight", phase.get("insight", "")),
            user_email=user_email,
            duration_seconds=phase.get("duration_seconds", 0.0),
            filename=filename,
            total_duration=total_duration,
            liver_id=liver_id,
            liver_name=liver_name,
            sales_data=sales_data,
            set_products=set_products,
            screen_metrics=phase_screen_metrics,
            platform=platform,
            stream_date=stream_date,
            data_source=data_source,
            client=client,
        )
        point_ids.append(point_id)

    logger.info(
        f"Stored {len(point_ids)} phases for video={video_id}, liver={liver_id}"
    )
    return point_ids


def update_quality_score(
    video_id: str,
    phase_index: int,
    rating: int,
    client: QdrantClient = None,
):
    """
    Update the quality score of a stored analysis based on user feedback.

    Positive feedback (rating=1) increases the score by 0.2 (max 1.0).
    Negative feedback (rating=-1) decreases the score by 0.3 (min -1.0).
    """
    if client is None:
        client = get_qdrant_client()

    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{video_id}_{phase_index}"))

    points = client.retrieve(
        collection_name=COLLECTION_NAME,
        ids=[point_id],
        with_payload=True,
    )

    if not points:
        logger.warning(f"Point not found: {point_id}")
        return

    current = points[0].payload
    current_score = current.get("quality_score", 0.0)
    feedback_count = current.get("feedback_count", 0)

    if rating > 0:
        new_score = min(current_score + 0.2, 1.0)
    elif rating < 0:
        new_score = max(current_score - 0.3, -1.0)
    else:
        new_score = current_score

    client.set_payload(
        collection_name=COLLECTION_NAME,
        payload={
            "quality_score": new_score,
            "feedback_count": feedback_count + 1,
        },
        points=[point_id],
    )

    logger.info(
        f"Updated quality score for {point_id}: "
        f"{current_score:.2f} -> {new_score:.2f} (feedback #{feedback_count + 1})"
    )


def _build_sales_context(
    sales_data: Optional[Dict],
    set_products: Optional[List[Dict]],
    screen_metrics: Optional[Dict],
) -> str:
    """
    Build a text representation of sales/metrics data for embedding.

    Combines sales dashboard data (Pattern A) or screen recording
    metrics (Pattern B) into a structured text string that can be
    included in the embedding generation.
    """
    parts = []

    # Pattern A: TikTok dashboard data
    if sales_data:
        gmv = sales_data.get("gmv", 0)
        if gmv:
            parts.append(f"GMV: ¥{gmv:,.0f}")
        orders = sales_data.get("total_orders", 0)
        if orders:
            parts.append(f"注文数: {orders}")
        viewers = sales_data.get("viewers", 0)
        if viewers:
            parts.append(f"視聴者数: {viewers:,.0f}")
        cvr = sales_data.get("cvr", 0)
        if cvr:
            parts.append(f"CVR: {cvr}%")
        live_ctr = sales_data.get("live_ctr", 0)
        if live_ctr:
            parts.append(f"LIVE CTR: {live_ctr}%")
        impressions = sales_data.get("impressions", 0)
        if impressions:
            parts.append(f"インプレッション: {impressions:,.0f}")
        product_clicks = sales_data.get("product_clicks", 0)
        if product_clicks:
            parts.append(f"商品クリック数: {product_clicks:,.0f}")
        comment_rate = sales_data.get("comment_rate", 0)
        if comment_rate:
            parts.append(f"コメント率: {comment_rate}%")
        tap_through = sales_data.get("tap_through_rate", 0)
        if tap_through:
            parts.append(f"タップスルー率: {tap_through}%")
        avg_gpm = sales_data.get("avg_gpm", 0)
        if avg_gpm:
            parts.append(f"時間あたりGMV: ¥{avg_gpm:,.0f}")
        duration = sales_data.get("duration_minutes", 0)
        if duration:
            parts.append(f"配信時間: {duration}分")

    # Pattern A: Set product data
    if set_products:
        parts.append("セット商品:")
        for sp in set_products[:5]:
            name = sp.get("name", "")
            qty = sp.get("quantity_sold", 0)
            rev = sp.get("set_revenue", 0)
            discount = sp.get("discount_rate", 0)
            parts.append(
                f"  {name}: {qty}セット販売, ¥{rev:,.0f}, {discount}%OFF"
            )

    # Pattern B: Screen recording metrics (extracted from UI overlay)
    if screen_metrics:
        viewer_count = screen_metrics.get("viewer_count", 0)
        if viewer_count:
            parts.append(f"リアルタイム視聴者数: {viewer_count}")
        likes = screen_metrics.get("likes", 0)
        if likes:
            parts.append(f"いいね数: {likes}")
        hearts = screen_metrics.get("hearts", 0)
        if hearts:
            parts.append(f"ハート数: {hearts}")
        shopping_rank = screen_metrics.get("shopping_rank", "")
        if shopping_rank:
            parts.append(f"ショッピングランキング: {shopping_rank}")
        product_browsing = screen_metrics.get("product_browsing", "")
        if product_browsing:
            parts.append(f"商品閲覧: {product_browsing}")
        purchase_notifications = screen_metrics.get("purchase_notifications", [])
        if purchase_notifications:
            parts.append(f"購入通知数: {len(purchase_notifications)}")
        comments = screen_metrics.get("comments", [])
        if comments:
            parts.append(f"コメント数: {len(comments)}")
            for c in comments[:5]:
                parts.append(f"  コメント: {c}")
        viewer_trend = screen_metrics.get("viewer_trend", "")
        if viewer_trend:
            parts.append(f"視聴者推移: {viewer_trend}")

    return "\n".join(parts)

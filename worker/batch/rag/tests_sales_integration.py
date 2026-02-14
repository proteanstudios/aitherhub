"""
Tests for aitherhub RAG v2 - Sales Data Integration.

Tests the sales data ingestion, storage, retrieval, and prompt building
functionality. Uses mock objects to avoid requiring actual Qdrant or
Azure OpenAI connections.

Run with: pytest tests/test_sales_integration.py -v
"""

import json
import pytest
from unittest.mock import patch, MagicMock
from typing import Dict, List


# ============================================================
# Test Data Fixtures
# ============================================================

@pytest.fixture
def sample_sales_data() -> Dict:
    """Sample TikTok LIVE dashboard data."""
    return {
        "gmv": 150000,
        "total_orders": 45,
        "product_sales_count": 52,
        "viewers": 3200,
        "impressions": 85000,
        "product_impressions": 12000,
        "product_clicks": 2400,
        "live_ctr": 2.8,
        "cvr": 1.9,
        "tap_through_rate": 20.0,
        "comment_rate": 3.5,
        "avg_gpm": 2500,
        "duration_minutes": 60,
        "follower_ratio": 35.0,
        "traffic_sources": [
            {
                "channel": "For You",
                "gmv_pct": 60,
                "impression_pct": 70,
                "viewer_pct": 65,
            },
            {
                "channel": "Following",
                "gmv_pct": 25,
                "impression_pct": 15,
                "viewer_pct": 20,
            },
        ],
    }


@pytest.fixture
def sample_set_products() -> List[Dict]:
    """Sample set product data."""
    return [
        {
            "name": "美容セットA",
            "price": 3980,
            "original_price": 6000,
            "discount_rate": 33,
            "quantity_sold": 15,
            "set_revenue": 59700,
            "items": ["美容液", "化粧水", "クリーム"],
        },
        {
            "name": "スキンケアセットB",
            "price": 2980,
            "original_price": 4500,
            "discount_rate": 34,
            "quantity_sold": 20,
            "set_revenue": 59600,
            "items": ["洗顔料", "化粧水"],
        },
    ]


@pytest.fixture
def sample_screen_metrics() -> Dict:
    """Sample screen recording metrics."""
    return {
        "viewer_count": 1500,
        "viewer_count_min": 800,
        "viewer_count_avg": 1200,
        "viewer_trend": "increasing",
        "likes": 5000,
        "hearts": 3000,
        "shopping_rank": 5,
        "comments": ["いいね！", "買います", "色は何色ですか？"],
        "comment_count": 45,
        "purchase_notifications": ["Aさんが購入しました", "Bさんが購入しました"],
        "purchase_count": 12,
        "product_browsing": "美容セットA 閲覧中",
        "frames_analyzed": 10,
    }


@pytest.fixture
def sample_phases() -> List[Dict]:
    """Sample phase analysis results."""
    return [
        {
            "phase_type": "product_demo",
            "speech_text": "この美容液は天然成分100%で作られています",
            "visual_context": "配信者が美容液のボトルを手に持って説明している",
            "behavior_label": "product_demo",
            "ai_insight": "商品の成分に焦点を当てた効果的なデモンストレーション",
            "duration_seconds": 120.0,
        },
        {
            "phase_type": "price_explanation",
            "speech_text": "通常6000円のところ、今日は特別に3980円でご提供します",
            "visual_context": "価格カードが画面に表示されている",
            "behavior_label": "price_explanation",
            "ai_insight": "割引率を強調した価格訴求が効果的",
            "duration_seconds": 60.0,
        },
        {
            "phase_type": "call_to_action",
            "speech_text": "残り10セットです！今すぐカートに入れてください",
            "visual_context": "配信者が急いでいるジェスチャーをしている",
            "behavior_label": "call_to_action",
            "ai_insight": "希少性を利用した購入促進が視聴者の行動を促している",
            "duration_seconds": 45.0,
        },
    ]


# ============================================================
# Tests: Sales Data Ingester
# ============================================================

class TestSalesDataIngester:
    """Tests for the sales_data_ingester module."""

    def test_normalize_sales_data(self):
        """Test normalization of raw sales data."""
        from rag.sales_data_ingester import _normalize_sales_data

        raw = {
            "gmv": "150,000",
            "total_orders": "45",
            "cvr": "1.9%",
            "viewers": 3200,
        }
        result = _normalize_sales_data(raw)

        assert result["gmv"] == 150000.0
        assert result["total_orders"] == 45
        assert result["cvr"] == 1.9
        assert result["viewers"] == 3200

    def test_normalize_product(self):
        """Test normalization of product data."""
        from rag.sales_data_ingester import _normalize_product

        raw = {
            "name": "テストセット",
            "price": 3980,
            "quantity_sold": 15,
        }
        result = _normalize_product(raw)

        assert result["name"] == "テストセット"
        assert result["price"] == 3980.0
        assert result["quantity_sold"] == 15
        assert result["set_revenue"] == 3980.0 * 15  # Auto-calculated

    def test_ingest_from_lcj_api(self, sample_sales_data, sample_set_products):
        """Test ingestion from LCJ API format."""
        from rag.sales_data_ingester import ingest_from_lcj_api

        lcj_data = {
            "sales_summary": sample_sales_data,
            "products": sample_set_products,
        }

        sales_data, set_products = ingest_from_lcj_api(lcj_data)

        assert sales_data["gmv"] == 150000.0
        assert sales_data["total_orders"] == 45
        assert len(set_products) == 2
        assert set_products[0]["name"] == "美容セットA"

    def test_ingest_from_json(self, sample_sales_data):
        """Test ingestion from JSON string."""
        from rag.sales_data_ingester import ingest_from_json

        json_str = json.dumps(sample_sales_data)
        sales_data, set_products = ingest_from_json(json_str)

        assert sales_data["gmv"] == 150000.0
        assert sales_data["cvr"] == 1.9

    def test_ingest_from_csv(self):
        """Test ingestion from CSV string."""
        from rag.sales_data_ingester import ingest_from_csv

        csv_content = "metric,value\ngmv,150000\ntotal_orders,45\ncvr,1.9\n"
        sales_data, set_products = ingest_from_csv(csv_content)

        assert sales_data["gmv"] == 150000.0
        assert sales_data["total_orders"] == 45
        assert sales_data["cvr"] == 1.9

    def test_safe_float_edge_cases(self):
        """Test _safe_float with various edge cases."""
        from rag.sales_data_ingester import _safe_float

        assert _safe_float(None) == 0.0
        assert _safe_float("") == 0.0
        assert _safe_float("¥150,000") == 150000.0
        assert _safe_float("1.9%") == 1.9
        assert _safe_float(42) == 42.0
        assert _safe_float("invalid") == 0.0


# ============================================================
# Tests: Knowledge Store
# ============================================================

class TestKnowledgeStore:
    """Tests for the knowledge_store module."""

    def test_build_sales_context(self, sample_sales_data, sample_set_products):
        """Test building sales context string for embedding."""
        from rag.knowledge_store import _build_sales_context

        context = _build_sales_context(
            sales_data=sample_sales_data,
            set_products=sample_set_products,
            screen_metrics=None,
        )

        assert "GMV: ¥150,000" in context
        assert "注文数: 45" in context
        assert "CVR: 1.9%" in context
        assert "美容セットA" in context

    def test_build_sales_context_screen_metrics(self, sample_screen_metrics):
        """Test building sales context from screen metrics."""
        from rag.knowledge_store import _build_sales_context

        context = _build_sales_context(
            sales_data=None,
            set_products=None,
            screen_metrics=sample_screen_metrics,
        )

        assert "リアルタイム視聴者数: 1500" in context
        assert "いいね数: 5000" in context
        assert "ショッピングランキング: 5" in context

    def test_build_sales_context_empty(self):
        """Test building sales context with no data."""
        from rag.knowledge_store import _build_sales_context

        context = _build_sales_context(None, None, None)
        assert context == ""


# ============================================================
# Tests: RAG Prompt Builder
# ============================================================

class TestRagPromptBuilder:
    """Tests for the rag_prompt_builder module."""

    def test_build_rag_phase_label_prompt_with_sales(self):
        """Test phase label prompt includes sales data from examples."""
        from rag.rag_prompt_builder import build_rag_phase_label_prompt

        similar = [
            {
                "speech_text": "この商品は大人気です",
                "visual_context": "商品を持っている",
                "behavior_label": "product_demo",
                "ai_insight": "効果的なデモ",
                "sales_data": {"gmv": 200000, "total_orders": 60, "cvr": 2.5},
            }
        ]

        prompt = build_rag_phase_label_prompt(
            current_visual_context="配信者が商品を見せている",
            current_speech_text="今日の商品はこちらです",
            similar_analyses=similar,
        )

        assert "GMV ¥200,000" in prompt
        assert "注文数 60" in prompt
        assert "CVR 2.5%" in prompt

    def test_build_rag_insight_prompt_with_sales(
        self, sample_sales_data, sample_screen_metrics
    ):
        """Test insight prompt includes current sales data."""
        from rag.rag_prompt_builder import build_rag_insight_prompt

        prompt = build_rag_insight_prompt(
            labeled_phases=[
                {"behavior_label": "product_demo", "speech_text": "テスト"}
            ],
            similar_insights=[],
            current_sales_data=sample_sales_data,
            current_screen_metrics=sample_screen_metrics,
        )

        assert "今回の配信の売上データ" in prompt
        assert "GMV（総売上）: ¥150,000" in prompt
        assert "今回の配信の画面収録データ" in prompt
        assert "リアルタイム視聴者数: 1500" in prompt
        assert "売上との相関分析" in prompt

    def test_build_rag_report_prompt_comprehensive(
        self,
        sample_sales_data,
        sample_set_products,
        sample_screen_metrics,
    ):
        """Test comprehensive report prompt with all data sources."""
        from rag.rag_prompt_builder import build_rag_report_prompt

        liver_history = [
            {
                "sales_data": {"gmv": 100000, "cvr": 1.5},
                "ai_insight": "前回は商品説明が短かった",
                "stream_date": "2026-02-01",
                "created_at": "2026-02-01T12:00:00",
            }
        ]

        top_performers = [
            {
                "sales_data": {"gmv": 500000, "cvr": 3.5, "total_orders": 150},
                "liver_name": "トップライバー",
                "ai_insight": "商品デモが非常に詳細で視聴者の質問に即座に回答",
            }
        ]

        prompt = build_rag_report_prompt(
            current_data={},
            similar_reports=[],
            current_sales_data=sample_sales_data,
            current_set_products=sample_set_products,
            current_screen_metrics=sample_screen_metrics,
            liver_history=liver_history,
            top_performers=top_performers,
        )

        # Check all sections are present
        assert "トップパフォーマー" in prompt
        assert "GMV ¥500,000" in prompt
        assert "トップライバー" in prompt
        assert "過去の配信履歴" in prompt
        assert "今回の配信の売上データ" in prompt
        assert "セット商品の販売実績" in prompt
        assert "美容セットA" in prompt
        assert "画面収録データ" in prompt
        assert "成長トレンド分析" in prompt


# ============================================================
# Tests: Screen Metrics Extractor
# ============================================================

class TestScreenMetricsExtractor:
    """Tests for the screen_metrics_extractor module."""

    def test_aggregate_metrics(self):
        """Test aggregation of metrics from multiple frames."""
        from rag.screen_metrics_extractor import _aggregate_metrics

        metrics_list = [
            {
                "viewer_count": 1000,
                "likes": 3000,
                "comments": ["コメント1"],
                "purchase_notifications": ["購入1"],
            },
            {
                "viewer_count": 1500,
                "likes": 5000,
                "comments": ["コメント2"],
                "purchase_notifications": ["購入2"],
            },
            {
                "viewer_count": 1200,
                "likes": 4000,
                "comments": ["コメント1", "コメント3"],
                "purchase_notifications": [],
            },
        ]

        result = _aggregate_metrics(metrics_list)

        assert result["viewer_count"] == 1500  # max
        assert result["viewer_count_min"] == 1000  # min
        assert result["likes"] == 5000  # max
        assert result["comment_count"] == 3  # unique
        assert result["purchase_count"] == 2  # unique
        assert result["frames_analyzed"] == 3

    def test_calculate_trend(self):
        """Test trend calculation."""
        from rag.screen_metrics_extractor import _calculate_trend

        assert _calculate_trend([100, 200, 300, 400]) == "increasing"
        assert _calculate_trend([400, 300, 200, 100]) == "decreasing"
        assert _calculate_trend([100, 100, 100, 100]) == "stable"
        assert _calculate_trend([100]) == "insufficient_data"
        assert _calculate_trend([]) == "insufficient_data"


# ============================================================
# Tests: Integration Flow
# ============================================================

class TestIntegrationFlow:
    """End-to-end integration tests (with mocks)."""

    @patch("rag.embedding_service._get_client")
    @patch("rag.knowledge_store.init_collection")
    @patch("rag.knowledge_store.get_qdrant_client")
    def test_store_and_retrieve_flow(
        self,
        mock_qdrant,
        mock_init_collection,
        mock_openai,
        sample_sales_data,
        sample_set_products,
        sample_phases,
    ):
        """Test the full store -> retrieve flow with sales data."""
        # Mock embedding response
        mock_embedding_response = MagicMock()
        mock_embedding_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_openai_client = MagicMock()
        mock_openai_client.embeddings.create.return_value = mock_embedding_response
        mock_openai.return_value = mock_openai_client

        # Mock Qdrant client
        mock_client = MagicMock()
        mock_qdrant.return_value = mock_client
        mock_init_collection.return_value = mock_client

        from rag.knowledge_store import store_video_analysis

        point_ids = store_video_analysis(
            video_id="test-video-001",
            phases=sample_phases,
            user_email="test@example.com",
            liver_id="liver-001",
            liver_name="テストライバー",
            sales_data=sample_sales_data,
            set_products=sample_set_products,
            platform="tiktok",
            stream_date="2026-02-15",
            data_source="clean",
        )

        assert len(point_ids) == 3
        assert mock_client.upsert.call_count == 3

        # Verify sales data was included in the payload
        first_call = mock_client.upsert.call_args_list[0]
        points = first_call.kwargs.get("points", first_call[1].get("points", []))
        if points:
            payload = points[0].payload
            assert payload["sales_data"]["gmv"] == 150000
            assert payload["liver_id"] == "liver-001"
            assert len(payload["set_products"]) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

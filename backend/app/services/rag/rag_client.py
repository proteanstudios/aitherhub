"""
Qdrant Vector Database Client for aitherhub RAG system (v2 - Extended).

Manages connection to Qdrant and provides collection initialization.
Collections store vectorized analysis results for retrieval during
new video analyses.

v2 Extensions:
- Additional payload indexes for sales data filtering (liver_id, GMV)
- Index migration support for existing collections
- Qdrant Cloud support (URL + API key authentication)
"""

import os
import logging
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    Range,
)

logger = logging.getLogger("rag_client")

# Configuration - supports both Qdrant Cloud (URL) and self-hosted (host:port)
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_HOST = os.getenv("QDRANT_HOST", "qdrant")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

COLLECTION_NAME = "video_analysis_knowledge"
VECTOR_SIZE = 1536  # OpenAI text-embedding-3-small dimension


def get_qdrant_client() -> QdrantClient:
    """
    Create and return a Qdrant client instance.

    Supports two connection modes:
    - Qdrant Cloud: Uses QDRANT_URL + QDRANT_API_KEY (preferred)
    - Self-hosted: Uses QDRANT_HOST + QDRANT_PORT (fallback)
    """
    if QDRANT_URL:
        logger.info(f"Connecting to Qdrant Cloud: {QDRANT_URL[:50]}...")
        return QdrantClient(
            url=QDRANT_URL,
            api_key=QDRANT_API_KEY if QDRANT_API_KEY else None,
        )
    else:
        logger.info(f"Connecting to self-hosted Qdrant: {QDRANT_HOST}:{QDRANT_PORT}")
        return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def init_collection(client: QdrantClient = None):
    """
    Initialize the Qdrant collection for storing video analysis knowledge.
    Creates the collection if it does not already exist.

    v2: Adds indexes for liver_id, sales_data.gmv, and metadata.data_source
    to support sales-aware and liver-specific retrieval.
    """
    if client is None:
        client = get_qdrant_client()

    collections = client.get_collections().collections
    existing_names = [c.name for c in collections]

    if COLLECTION_NAME not in existing_names:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=VECTOR_SIZE,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"Created Qdrant collection: {COLLECTION_NAME}")

        # Create payload indexes for efficient filtering
        _create_all_indexes(client)
        logger.info("Created all payload indexes")
    else:
        logger.info(f"Collection {COLLECTION_NAME} already exists")
        # Ensure v2 indexes exist on existing collections
        _ensure_v2_indexes(client)

    return client


def _create_all_indexes(client: QdrantClient):
    """Create all payload indexes for the collection."""
    indexes = [
        # v1 indexes
        ("phase_type", "keyword"),
        ("quality_score", "float"),
        ("user_email", "keyword"),
        # v2 indexes for sales data integration
        ("liver_id", "keyword"),
        ("sales_data.gmv", "float"),
        ("sales_data.cvr", "float"),
        ("sales_data.total_orders", "integer"),
        ("metadata.data_source", "keyword"),
        ("metadata.platform", "keyword"),
        ("metadata.stream_date", "keyword"),
    ]

    for field_name, field_schema in indexes:
        try:
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=field_schema,
            )
            logger.info(f"Created index: {field_name} ({field_schema})")
        except Exception as e:
            # Index may already exist
            logger.debug(f"Index creation skipped for {field_name}: {e}")


def _ensure_v2_indexes(client: QdrantClient):
    """
    Ensure v2 indexes exist on an existing collection.
    This is safe to call multiple times - duplicate index creation
    is handled gracefully.
    """
    v2_indexes = [
        ("liver_id", "keyword"),
        ("sales_data.gmv", "float"),
        ("sales_data.cvr", "float"),
        ("sales_data.total_orders", "integer"),
        ("metadata.data_source", "keyword"),
        ("metadata.platform", "keyword"),
        ("metadata.stream_date", "keyword"),
    ]

    for field_name, field_schema in v2_indexes:
        try:
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=field_schema,
            )
            logger.info(f"Added v2 index: {field_name}")
        except Exception:
            pass  # Index already exists

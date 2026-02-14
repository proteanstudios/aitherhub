"""
Qdrant Vector Database Client for aitherhub RAG system.

Manages connection to Qdrant and provides collection initialization.
Collections store vectorized analysis results for retrieval during
new video analyses.
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

# Configuration
QDRANT_HOST = os.getenv("QDRANT_HOST", "qdrant")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION_NAME = "video_analysis_knowledge"
VECTOR_SIZE = 1536  # OpenAI text-embedding-3-small dimension


def get_qdrant_client() -> QdrantClient:
    """Create and return a Qdrant client instance."""
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def init_collection(client: QdrantClient = None):
    """
    Initialize the Qdrant collection for storing video analysis knowledge.
    Creates the collection if it does not already exist.
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
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="phase_type",
            field_schema="keyword",
        )
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="quality_score",
            field_schema="float",
        )
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="user_email",
            field_schema="keyword",
        )
        logger.info("Created payload indexes for filtering")
    else:
        logger.info(f"Collection {COLLECTION_NAME} already exists")

    return client
